import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import YahooFinance from 'yahoo-finance2';
import type { PriceUpdateLogEntry } from '../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const PORTFOLIOS_DIR = path.join(ROOT, 'data', 'portfolios');
const BACKUPS_DIR = path.join(ROOT, 'data', 'backups');
const LOG_FILE = path.join(ROOT, 'data', 'price-update-log.json');
const LOG_MAX = 500;
const FUTURES_LOG_FILE = path.join(ROOT, 'data', 'futures-price-update-log.json');
const FUTURES_LOG_MAX = 300;

// yahoo-finance2 instance (suppress survey notice)
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Directory setup ──────────────────────────────────────────────────────────

for (const dir of [path.join(ROOT, 'data'), PORTFOLIOS_DIR, BACKUPS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Multi-portfolio helpers ──────────────────────────────────────────────────

type PortfolioId = 'personal' | 'company';

const VALID_PORTFOLIO_IDS: PortfolioId[] = ['personal', 'company'];

function validatePortfolioId(id: string): id is PortfolioId {
  return (VALID_PORTFOLIO_IDS as string[]).includes(id);
}

function getPortfolioFile(portfolioId: PortfolioId): string {
  return path.join(PORTFOLIOS_DIR, `${portfolioId}.json`);
}

const EMPTY_COMPANY_PORTFOLIO = {
  items: [],
  summary: {
    nikkeiFutures: null,
    topixFutures: null,
    totalAssets: null,
    hedgeFutures: {
      grossNikkei: { price: null, lots: null, multiplier: 100,   source: 'nikkei225jp',   symbol: 'c=138', lastUpdatedAt: null, updateStatus: 'unknown', updateError: null },
      nikkei:      { price: null, lots: null, multiplier: 1000,  source: 'yahoo-finance', symbol: 'NIY=F', lastUpdatedAt: null, updateStatus: 'unknown', updateError: null },
      topix:       { price: null, lots: null, multiplier: 10000, source: 'yahoo-finance', symbol: 'TPY=F', lastUpdatedAt: null, updateStatus: 'unknown', updateError: null },
    },
  },
  lastSaved: null,
};

// ─── Migration: portfolio.json → portfolios/personal.json ───────────────────

const LEGACY_FILE = path.join(ROOT, 'data', 'portfolio.json');
const PERSONAL_FILE = getPortfolioFile('personal');
const COMPANY_FILE  = getPortfolioFile('company');

if (!fs.existsSync(PERSONAL_FILE)) {
  if (fs.existsSync(LEGACY_FILE)) {
    fs.copyFileSync(LEGACY_FILE, PERSONAL_FILE);
    console.log('[migration] Copied data/portfolio.json → data/portfolios/personal.json');
  } else {
    fs.writeFileSync(PERSONAL_FILE, JSON.stringify(EMPTY_COMPANY_PORTFOLIO, null, 2), 'utf-8');
    console.log('[migration] Created empty data/portfolios/personal.json');
  }
}

if (!fs.existsSync(COMPANY_FILE)) {
  fs.writeFileSync(COMPANY_FILE, JSON.stringify(EMPTY_COMPANY_PORTFOLIO, null, 2), 'utf-8');
  console.log('[migration] Created empty data/portfolios/company.json');
}

// ─── Backup helper ────────────────────────────────────────────────────────────

function createPortfolioBackup(portfolioId: PortfolioId): string | null {
  const file = getPortfolioFile(portfolioId);
  if (!fs.existsSync(file)) return null;
  const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
  const backupFile = path.join(BACKUPS_DIR, `${portfolioId}_${ts}.json`);
  fs.copyFileSync(file, backupFile);
  // Keep last 30 backups per portfolio
  const pfBackups = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith(`${portfolioId}_`))
    .sort();
  if (pfBackups.length > 30) {
    pfBackups.slice(0, pfBackups.length - 30).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); } catch { /* ignore */ }
    });
  }
  return backupFile;
}

// ─── Yahoo Finance crumb session ──────────────────────────────────────────────

interface YFSession {
  cookie: string;
  crumb: string;
  obtainedAt: number;
}

let yfSession: YFSession | null = null;
const SESSION_TTL_MS = 50 * 60 * 1000;

async function getYFSession(forceRefresh = false): Promise<YFSession> {
  const now = Date.now();
  if (!forceRefresh && yfSession && (now - yfSession.obtainedAt) < SESSION_TTL_MS) {
    return yfSession;
  }

  console.log('[yf-session] Obtaining new crumb/cookie...');

  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });
  const rawCookies = (r1.headers.raw()['set-cookie'] ?? []) as string[];
  const cookie = rawCookies.map((c: string) => c.split(';')[0]).join('; ');

  if (!cookie) {
    throw new Error('Yahoo Finance: failed to obtain session cookie');
  }

  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie },
  });
  const crumb = await r2.text();

  if (!crumb || crumb.includes('<html>') || r2.status !== 200) {
    throw new Error(`Yahoo Finance: failed to obtain crumb (HTTP ${r2.status})`);
  }

  console.log(`[yf-session] Session ready. crumb=${crumb.slice(0, 12)}...`);
  yfSession = { cookie, crumb, obtainedAt: Date.now() };
  return yfSession;
}

// ─── Price fetch helpers ──────────────────────────────────────────────────────

function toYahooSymbol(code: string): string {
  const trimmed = code.trim();
  return trimmed.endsWith('.T') ? trimmed : `${trimmed}.T`;
}

function extractPrice(quote: Record<string, unknown>): number | null {
  const candidates = [
    'regularMarketPrice',
    'currentPrice',
    'postMarketPrice',
    'previousClose',
  ];
  for (const key of candidates) {
    const val = quote[key];
    if (typeof val === 'number' && isFinite(val) && val > 0) {
      return val;
    }
  }
  return null;
}

async function fetchFromYahoo(
  codes: string[],
  session: YFSession
): Promise<Array<{ code: string; price: number | null; error: string | null }>> {
  const symbols = codes.map(toYahooSymbol).join(',');
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(session.crumb)}`;

  console.log(`[price-fetch] start symbols=${symbols}`);

  const response = await fetch(url, {
    headers: { 'User-Agent': UA, 'Cookie': session.cookie },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`AUTH_EXPIRED:HTTP ${response.status}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 100)}`);
  }

  const data = await response.json() as {
    quoteResponse?: {
      result?: Array<Record<string, unknown>>;
      error?: unknown;
    };
  };

  if (data?.quoteResponse?.error) {
    throw new Error(`Yahoo API error: ${JSON.stringify(data.quoteResponse.error)}`);
  }

  const quotes = data?.quoteResponse?.result ?? [];

  return codes.map(code => {
    const symbol = toYahooSymbol(code);
    const quote = quotes.find(q => q['symbol'] === symbol);

    if (!quote) {
      console.log(`[price-fetch] failed code=${code} symbol=${symbol} error=symbol not found in response`);
      return { code, price: null, error: 'シンボル未取得' };
    }

    const price = extractPrice(quote);
    if (price != null) {
      console.log(`[price-fetch] success code=${code} symbol=${symbol} price=${price}`);
      return { code, price, error: null };
    }

    console.log(`[price-fetch] failed code=${code} symbol=${symbol} error=no valid price in response`);
    return { code, price: null, error: '価格データなし' };
  });
}

async function fetchPricesWithRetry(
  codes: string[]
): Promise<Array<{ code: string; price: number | null; error: string | null }>> {
  let session = await getYFSession();

  try {
    return await fetchFromYahoo(codes, session);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    if (msg.startsWith('AUTH_EXPIRED')) {
      console.log('[price-fetch] Session expired, refreshing...');
      session = await getYFSession(true);
      return await fetchFromYahoo(codes, session);
    }

    throw e;
  }
}

// ─── Log helpers ──────────────────────────────────────────────────────────────

function appendPriceLog(entries: PriceUpdateLogEntry[]) {
  let existing: PriceUpdateLogEntry[] = [];
  if (fs.existsSync(LOG_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')); } catch { existing = []; }
  }
  const merged = [...entries, ...existing].slice(0, LOG_MAX);
  fs.writeFileSync(LOG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Portfolio CRUD (portfolioId-based) ─────────────────────────────────────

app.get('/api/portfolio/:portfolioId', (req, res) => {
  const { portfolioId } = req.params;
  if (!validatePortfolioId(portfolioId)) {
    res.status(400).json({ error: `Invalid portfolioId: ${portfolioId}` });
    return;
  }
  const file = getPortfolioFile(portfolioId);
  if (!fs.existsSync(file)) {
    res.json({ items: [], summary: { nikkeiFutures: null, topixFutures: null, totalAssets: null, hedgeFutures: EMPTY_COMPANY_PORTFOLIO.summary.hedgeFutures }, lastSaved: null });
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/portfolio/:portfolioId', (req, res) => {
  const { portfolioId } = req.params;
  if (!validatePortfolioId(portfolioId)) {
    res.status(400).json({ error: `Invalid portfolioId: ${portfolioId}` });
    return;
  }
  try {
    createPortfolioBackup(portfolioId);
    const portfolio = req.body;
    portfolio.lastSaved = new Date().toISOString();
    fs.writeFileSync(getPortfolioFile(portfolioId), JSON.stringify(portfolio, null, 2), 'utf-8');
    res.json({ ok: true, lastSaved: portfolio.lastSaved });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── Backup (portfolioId-based) ─────────────────────────────────────────────

app.post('/api/portfolio/:portfolioId/backup', (req, res) => {
  const { portfolioId } = req.params;
  if (!validatePortfolioId(portfolioId)) {
    res.status(400).json({ error: `Invalid portfolioId: ${portfolioId}` });
    return;
  }
  try {
    const file = createPortfolioBackup(portfolioId);
    res.json({ ok: true, file });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// ── Legacy aliases (delegate to personal) ──────────────────────────────────

app.get('/api/portfolio', (_req, res) => {
  const file = getPortfolioFile('personal');
  if (!fs.existsSync(file)) {
    res.json({ items: [], summary: { nikkeiFutures: null, topixFutures: null, totalAssets: null, hedgeFutures: EMPTY_COMPANY_PORTFOLIO.summary.hedgeFutures }, lastSaved: null });
    return;
  }
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/portfolio', (req, res) => {
  try {
    createPortfolioBackup('personal');
    const portfolio = req.body;
    portfolio.lastSaved = new Date().toISOString();
    fs.writeFileSync(getPortfolioFile('personal'), JSON.stringify(portfolio, null, 2), 'utf-8');
    res.json({ ok: true, lastSaved: portfolio.lastSaved });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/backup', (_req, res) => {
  try {
    const file = createPortfolioBackup('personal');
    res.json({ ok: true, file });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// ── Debug: single code test ────────────────────────────────────────────────

app.get('/api/stock-price/test/:code', async (req, res) => {
  const inputCode = req.params.code.trim();
  const symbol = toYahooSymbol(inputCode);
  console.log(`[stock-price/test] code=${inputCode} symbol=${symbol}`);

  try {
    const session = await getYFSession();
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&crumb=${encodeURIComponent(session.crumb)}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': UA, 'Cookie': session.cookie },
    });
    const rawBody = await response.text();

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(rawBody); } catch { /* ignore */ }

    const quotes = (parsed as {
      quoteResponse?: { result?: Array<Record<string, unknown>> };
    })?.quoteResponse?.result ?? [];
    const quote = quotes[0] ?? null;
    const price = quote ? extractPrice(quote) : null;

    res.json({
      inputCode,
      symbol,
      success: price != null,
      price,
      httpStatus: response.status,
      rawResponse: {
        quoteResponse: (parsed as { quoteResponse?: unknown })?.quoteResponse ?? null,
      },
      error: price == null ? (quote ? '価格フィールドなし' : 'シンボル未取得') : null,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error(`[stock-price/test] error: ${errMsg}`);
    res.json({ inputCode, symbol, success: false, price: null, error: errMsg, stack });
  }
});

// ── Bulk price fetch ────────────────────────────────────────────────────────

app.post('/api/prices/fetch', async (req, res) => {
  const { codes } = req.body as { codes: string[] };
  const updatedAt = new Date().toISOString();

  if (!codes || codes.length === 0) {
    res.json({ results: [], updatedAt });
    return;
  }

  const validCodes = codes.map(c => c.trim()).filter(Boolean);
  console.log(`[price-fetch] bulk start: ${validCodes.length} codes`);

  let results: Array<{ code: string; price: number | null; error: string | null }>;

  try {
    results = await fetchPricesWithRetry(validCodes);

    const failed = results.filter(r => r.price == null);
    if (failed.length > 0 && failed.length < validCodes.length) {
      console.log(`[price-fetch] retrying ${failed.length} failed codes individually...`);
      await sleep(600);
      const retried = await Promise.allSettled(
        failed.map(async (f, i) => {
          await sleep(i * 200);
          const r = await fetchPricesWithRetry([f.code]);
          return r[0];
        })
      );
      retried.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.price != null) {
          const idx = results.findIndex(x => x.code === failed[i].code);
          if (idx >= 0) results[idx] = r.value;
        }
      });
    }

    const success = results.filter(r => r.price != null).length;
    const fail = results.filter(r => r.price == null).length;
    console.log(`[price-fetch] bulk done: success=${success} failed=${fail}`);

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[price-fetch] bulk error:', errMsg);
    if (e instanceof Error) console.error(e.stack);
    results = validCodes.map(code => ({ code, price: null, error: errMsg }));
  }

  res.json({ results, updatedAt });
});

// ── Price update log ────────────────────────────────────────────────────────

app.get('/api/prices/log', (_req, res) => {
  if (!fs.existsSync(LOG_FILE)) { res.json({ entries: [] }); return; }
  try {
    res.json({ entries: JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')) });
  } catch {
    res.json({ entries: [] });
  }
});

app.post('/api/prices/log', (req, res) => {
  const { entries } = req.body as { entries: PriceUpdateLogEntry[] };
  try {
    appendPriceLog(entries);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// ── Futures price helpers ──────────────────────────────────────────────────

function appendFuturesLog(entries: Array<{
  updatedAt: string; name: string; source: string; symbol: string;
  previousPrice: number | null; newPrice: number | null;
  status: 'success' | 'failed'; error: string | null;
}>) {
  let existing: unknown[] = [];
  if (fs.existsSync(FUTURES_LOG_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(FUTURES_LOG_FILE, 'utf-8')); } catch { existing = []; }
  }
  const merged = [...entries, ...existing].slice(0, FUTURES_LOG_MAX);
  fs.writeFileSync(FUTURES_LOG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

async function fetchGrowthFuturesPrice(): Promise<{ price: number | null; error: string | null; rawSnippet: string }> {
  const url = 'https://nikkei225jp.com/_ssi/if/?c=138';
  const CODE = '138';

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,*/*;q=0.8',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`nikkei225jp HTTP ${response.status}`);
  const html = await response.text() as string;

  const aMatch = html.match(new RegExp(`A\\[${CODE}\\]="([^"]+)"`));
  if (aMatch) {
    const parsed = parseFloat(aMatch[1].split('_')[0].replace(',', ''));
    if (isFinite(parsed) && parsed > 0) {
      return { price: parsed, error: null, rawSnippet: aMatch[0] };
    }
  }

  const ldataMatch = html.match(/[,;]\s*Ldata="([^"]+)"/);
  if (ldataMatch) {
    const parsed = parseFloat(ldataMatch[1].replace(',', ''));
    if (isFinite(parsed) && parsed > 0) {
      return { price: parsed, error: null, rawSnippet: ldataMatch[0] };
    }
  }

  return { price: null, error: `Price pattern not found in HTML (len=${html.length})`, rawSnippet: '' };
}

async function fetchYahooFuturesPrice(symbol: string): Promise<{ price: number | null; error: string | null; raw?: unknown }> {
  const quote = await yf.quote(symbol);
  const candidates = [
    (quote as Record<string, unknown>)['regularMarketPrice'],
    (quote as Record<string, unknown>)['currentPrice'],
    (quote as Record<string, unknown>)['postMarketPrice'],
    (quote as Record<string, unknown>)['regularMarketPreviousClose'],
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && isFinite(c) && c > 0) {
      return { price: c, error: null, raw: { regularMarketPrice: (quote as Record<string, unknown>)['regularMarketPrice'], shortName: (quote as Record<string, unknown>)['shortName'] } };
    }
  }
  return { price: null, error: 'No valid price field found', raw: quote };
}

const FUTURES_CONFIG = [
  { key: 'grossNikkei' as const, name: 'グロ先',     source: 'nikkei225jp',   symbol: 'c=138'  },
  { key: 'nikkei'      as const, name: '日経先物',   source: 'yahoo-finance', symbol: 'NIY=F'  },
  { key: 'topix'       as const, name: 'TOPIX先物', source: 'yahoo-finance', symbol: 'TPY=F'  },
];

// ── Futures prices: bulk update API ───────────────────────────────────────

app.post('/api/futures-prices/update', async (_req, res) => {
  const updatedAt = new Date().toISOString();
  console.log('[futures-prices/update] Starting bulk update...');

  const settled = await Promise.allSettled(
    FUTURES_CONFIG.map(async cfg => {
      let price: number | null = null;
      let error: string | null = null;
      let rawSnippet = '';

      try {
        if (cfg.source === 'nikkei225jp') {
          const r = await fetchGrowthFuturesPrice();
          price = r.price;
          error = r.error;
          rawSnippet = r.rawSnippet;
        } else {
          const r = await fetchYahooFuturesPrice(cfg.symbol);
          price = r.price;
          error = r.error;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const status = price != null ? 'success' : 'failed';
      console.log(`[futures-prices/update] ${cfg.name} (${cfg.symbol}): ${status} price=${price} ${error ? `error=${error}` : ''}`);

      return { ...cfg, price, status, error, rawSnippet };
    })
  );

  const results = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const cfg = FUTURES_CONFIG[i];
    return { ...cfg, price: null, status: 'failed' as const, error: r.reason?.message ?? String(r.reason), rawSnippet: '' };
  });

  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount  = results.filter(r => r.status === 'failed').length;

  try {
    appendFuturesLog(results.map(r => ({
      updatedAt,
      name: r.name,
      source: r.source,
      symbol: r.symbol,
      previousPrice: null,
      newPrice: r.price,
      status: r.status as 'success' | 'failed',
      error: r.error ?? null,
    })));
  } catch (e) {
    console.error('[futures-prices/update] Log write failed:', e);
  }

  res.json({ results, updatedAt, successCount, failedCount });
});

// ── Futures prices: test endpoints ────────────────────────────────────────

app.get('/api/futures-price/test/growth', async (_req, res) => {
  try {
    const { price, error, rawSnippet } = await fetchGrowthFuturesPrice();
    res.json({
      source: 'nikkei225jp',
      symbol: 'c=138',
      success: price != null,
      price,
      rawSnippet: rawSnippet.slice(0, 200),
      error,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    res.json({ source: 'nikkei225jp', symbol: 'c=138', success: false, price: null, rawSnippet: '', error: errMsg, stack: (e instanceof Error ? e.stack : undefined) });
  }
});

app.get('/api/futures-price/test/yahoo/:symbol', async (req, res) => {
  const symbol = req.params.symbol;
  try {
    const { price, error, raw } = await fetchYahooFuturesPrice(symbol);
    res.json({
      source: 'yahoo-finance',
      symbol,
      success: price != null,
      price,
      raw,
      error,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    res.json({ source: 'yahoo-finance', symbol, success: false, price: null, raw: null, error: errMsg, stack: (e instanceof Error ? e.stack : undefined) });
  }
});

app.get('/api/futures-price/test-growth', async (_req, res) => {
  const sourceUrl = 'https://nikkei225jp.com/_ssi/if/?c=138';
  const CODE = '138';

  try {
    console.log(`[futures-price/test-growth] Fetching ${sourceUrl}`);

    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text() as string;
    console.log(`[futures-price/test-growth] HTML length: ${html.length}`);

    const aPattern = new RegExp(`A\\[${CODE}\\]="([^"]+)"`);
    const aMatch = html.match(aPattern);

    let detectedPrice: number | null = null;
    let detectedMethod = '';
    let rawSnippet = '';

    if (aMatch) {
      const fields = aMatch[1].split('_');
      const priceStr = fields[0].replace(',', '');
      const parsed = parseFloat(priceStr);
      if (isFinite(parsed) && parsed > 0) {
        detectedPrice = parsed;
        detectedMethod = `HTML regex: A[${CODE}]="${aMatch[1].slice(0, 60)}..."`;
        rawSnippet = aMatch[0];
      }
    }

    const ldataMatch = html.match(/[,;]\s*Ldata="([^"]+)"/);
    let ldataPrice: number | null = null;
    if (ldataMatch) {
      const parsed = parseFloat(ldataMatch[1].replace(',', ''));
      if (isFinite(parsed) && parsed > 0) {
        ldataPrice = parsed;
      }
    }

    const bdataMatch = html.match(/var\s+Bdata="([^"]+)"/);
    let bdataPrice: number | null = null;
    if (bdataMatch) {
      const parsed = parseFloat(bdataMatch[1].replace(',', ''));
      if (isFinite(parsed) && parsed > 0) {
        bdataPrice = parsed;
      }
    }

    const timeMatch = html.match(/[,;]\s*Time="([^"]+)"/);
    const perMatch  = html.match(/[,;]\s*Per="([^"]+)"/);
    const maxMatch  = html.match(/[,;]\s*Max="([^"]+)"/);
    const minMatch  = html.match(/[,;]\s*Min="([^"]+)"/);

    if (detectedPrice == null && ldataPrice != null) {
      detectedPrice = ldataPrice;
      detectedMethod = `HTML regex: Ldata="${ldataPrice}"`;
      rawSnippet = ldataMatch?.[0] ?? '';
    }

    const result = {
      success:         detectedPrice != null,
      sourceUrl,
      detectedPrice,
      detectedMethod:  detectedPrice != null ? detectedMethod : 'none — price not found',
      rawSnippet:      rawSnippet.slice(0, 200),
      extra: {
        ldataPrice,
        bdataPrice,
        time:    timeMatch?.[1] ?? null,
        change:  perMatch?.[1]  ?? null,
        high:    maxMatch?.[1]  ?? null,
        low:     minMatch?.[1]  ?? null,
        htmlLen: html.length,
        websocketUrl: 'wss://wss.nikkei225jp.com:8124?node=ch225',
        note: 'Code 138 is NOT in tick2.json. HTML scraping is the only method.',
      },
      error: detectedPrice == null ? 'Price pattern not found in HTML' : null,
    };

    console.log(`[futures-price/test-growth] price=${detectedPrice} method=${detectedMethod}`);
    res.json(result);

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const stack  = e instanceof Error ? e.stack : undefined;
    console.error('[futures-price/test-growth] error:', errMsg);
    res.json({
      success: false,
      sourceUrl,
      detectedPrice: null,
      detectedMethod: 'error',
      rawSnippet: '',
      extra: null,
      error: errMsg,
      stack,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(3001, () => {
  console.log('API server running at http://localhost:3001');
});
