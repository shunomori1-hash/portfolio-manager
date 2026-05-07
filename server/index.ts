import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import YahooFinance from 'yahoo-finance2';
import type { PriceUpdateLogEntry, FiscalMonthLogEntry, TechnicalLogEntry, TechRating, TechUpdateStatus } from '../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const PORTFOLIOS_DIR = path.join(ROOT, 'data', 'portfolios');
const BACKUPS_DIR = path.join(ROOT, 'data', 'backups');
const LOG_FILE = path.join(ROOT, 'data', 'price-update-log.json');
const LOG_MAX = 500;
const FUTURES_LOG_FILE = path.join(ROOT, 'data', 'futures-price-update-log.json');
const FUTURES_LOG_MAX = 300;
const FISCAL_LOG_FILE = path.join(ROOT, 'data', 'fiscal-month-update-log.json');
const FISCAL_LOG_MAX = 500;
const PRICE_HISTORY_DIR = path.join(ROOT, 'data', 'price-history');
const TECH_LOG_FILE = path.join(ROOT, 'data', 'technical-update-log.json');
const TECH_LOG_MAX = 500;

// yahoo-finance2 instance (suppress survey notice)
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Directory setup ──────────────────────────────────────────────────────────

for (const dir of [path.join(ROOT, 'data'), PORTFOLIOS_DIR, BACKUPS_DIR, PRICE_HISTORY_DIR]) {
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

// ── Fiscal month helpers ──────────────────────────────────────────────────

// Fetch fiscal year-end month for a single stock code using yahoo-finance2
// Returns month as 1–12, or null if unavailable.
// Designed to be replaceable with another data source if needed.
async function fetchFiscalYearEnd(code: string): Promise<{
  month: number | null;
  error: string | null;
  source: string;
}> {
  const symbol = toYahooSymbol(code);
  const source = 'yahoo-finance';
  try {
    const result = await yf.quoteSummary(symbol, { modules: ['defaultKeyStatistics'] });
    const stats = (result as Record<string, unknown>).defaultKeyStatistics as Record<string, unknown> | undefined;

    if (!stats) {
      return { month: null, error: 'defaultKeyStatistics not available', source };
    }

    // yahoo-finance2 returns lastFiscalYearEnd as an ISO date string or Date object
    // e.g. "2025-12-31T00:00:00.000Z" → month 12
    //      "2026-03-31T00:00:00.000Z" → month 3
    let month: number | null = null;

    for (const key of ['lastFiscalYearEnd', 'nextFiscalYearEnd', 'fiscalYearEnd']) {
      const rawVal = stats[key];
      if (rawVal == null) continue;

      // Date object from yahoo-finance2 (getMonth() is 0-indexed)
      if (rawVal instanceof Date) {
        const m = rawVal.getMonth() + 1;
        if (m >= 1 && m <= 12) { month = m; break; }
      }
      // ISO string: "YYYY-MM-DDT..."
      if (typeof rawVal === 'string') {
        const m = parseInt(rawVal.slice(5, 7), 10);
        if (m >= 1 && m <= 12) { month = m; break; }
      }
      // Plain number (1–12)
      if (typeof rawVal === 'number' && isFinite(rawVal)) {
        const m = Math.round(rawVal);
        if (m >= 1 && m <= 12) { month = m; break; }
      }
      // { raw: number } shape
      if (rawVal != null && typeof rawVal === 'object') {
        const r = (rawVal as Record<string, unknown>)['raw'];
        if (typeof r === 'number' && isFinite(r)) {
          const m = Math.round(r);
          if (m >= 1 && m <= 12) { month = m; break; }
        }
      }
    }

    if (month == null) {
      const tried = ['lastFiscalYearEnd', 'nextFiscalYearEnd', 'fiscalYearEnd']
        .map(k => `${k}=${JSON.stringify(stats[k])}`).join(', ');
      return { month: null, error: `No fiscal year-end month found (${tried})`, source };
    }
    return { month, error: null, source };
  } catch (e) {
    return { month: null, error: e instanceof Error ? e.message : String(e), source };
  }
}

function appendFiscalLog(entries: FiscalMonthLogEntry[]) {
  let existing: FiscalMonthLogEntry[] = [];
  if (fs.existsSync(FISCAL_LOG_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(FISCAL_LOG_FILE, 'utf-8')); } catch { existing = []; }
  }
  const merged = [...entries, ...existing].slice(0, FISCAL_LOG_MAX);
  fs.writeFileSync(FISCAL_LOG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

// ── Fiscal month: bulk fetch ────────────────────────────────────────────────

app.post('/api/fiscal-months/fetch', async (req, res) => {
  const { codes } = req.body as { codes: string[] };
  const fetchedAt = new Date().toISOString();

  if (!codes || codes.length === 0) {
    res.json({ results: [], fetchedAt });
    return;
  }

  const validCodes = codes.map((c: string) => c.trim()).filter(Boolean);
  console.log(`[fiscal-month/fetch] start: ${validCodes.length} codes`);

  const settled = await Promise.allSettled(
    validCodes.map(async (code, i) => {
      // stagger requests to avoid rate-limiting (300ms apart)
      if (i > 0) await sleep(i * 300);
      const { month, error, source } = await fetchFiscalYearEnd(code);
      const monthStr = month != null ? `${month}月` : null;
      const status = monthStr != null ? 'success' : 'failed';
      console.log(`[fiscal-month/fetch] ${code}: ${status} month=${monthStr ?? 'null'} ${error ? `error=${error}` : ''}`);
      return { code, month, monthStr, source, error };
    })
  );

  const results = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const err = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return { code: validCodes[i], month: null, monthStr: null, source: 'yahoo-finance', error: err };
  });

  const successCount = results.filter(r => r.monthStr != null).length;
  const failedCount  = results.filter(r => r.monthStr == null).length;
  console.log(`[fiscal-month/fetch] done: success=${successCount} failed=${failedCount}`);

  res.json({ results, fetchedAt });
});

// ── Fiscal month: log ──────────────────────────────────────────────────────

app.get('/api/fiscal-month/log', (_req, res) => {
  if (!fs.existsSync(FISCAL_LOG_FILE)) { res.json({ entries: [] }); return; }
  try {
    res.json({ entries: JSON.parse(fs.readFileSync(FISCAL_LOG_FILE, 'utf-8')) });
  } catch {
    res.json({ entries: [] });
  }
});

app.post('/api/fiscal-month/log', (req, res) => {
  const { entries } = req.body as { entries: FiscalMonthLogEntry[] };
  try {
    appendFiscalLog(entries);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// ── Fiscal month: debug single code ───────────────────────────────────────

app.get('/api/fiscal-month/test/:code', async (req, res) => {
  const code = req.params.code.trim();
  const symbol = toYahooSymbol(code);
  console.log(`[fiscal-month/test] code=${code} symbol=${symbol}`);

  try {
    const raw = await yf.quoteSummary(symbol, { modules: ['defaultKeyStatistics'] });
    const stats = (raw as Record<string, unknown>).defaultKeyStatistics;
    const { month, error, source } = await fetchFiscalYearEnd(code);
    const monthStr = month != null ? `${month}月` : null;
    res.json({
      code,
      symbol,
      success: month != null,
      month,
      monthStr,
      source,
      error,
      rawDefaultKeyStatistics: stats ?? null,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    res.json({ code, symbol, success: false, month: null, monthStr: null, source: 'yahoo-finance', error: errMsg, stack: (e instanceof Error ? e.stack : undefined) });
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

// ── Technical: types ──────────────────────────────────────────────────────

interface PriceHistoryEntry {
  date: string;             // YYYY-MM-DD
  close: number | null;
  adjClose: number | null;
  valueForTechnical: number;
}

interface PriceHistoryFile {
  code: string;
  symbol: string;
  lastFetchedAt: string;
  prices: PriceHistoryEntry[];
}

interface TechJudgementResult {
  rating: TechRating | null;
  ratingBeforeBreakout: TechRating | null;
  breakoutBoosted: boolean;
  reason: string;
  status: TechUpdateStatus;
  debug: Record<string, unknown>;
}

// ── Technical: price history helpers ────────────────────────────────────────

async function fetchPriceHistoryFromYahoo(code: string): Promise<PriceHistoryEntry[] | null> {
  const symbol = toYahooSymbol(code);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 340); // ~220+ trading days buffer

  try {
    const history = await yf.historical(symbol, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    });

    if (!history || history.length === 0) return null;

    const entries: PriceHistoryEntry[] = [];
    for (const row of history) {
      const adjClose = (row.adjClose != null && isFinite(row.adjClose) && row.adjClose > 0)
        ? row.adjClose : null;
      const close = (row.close != null && isFinite(row.close) && row.close > 0)
        ? row.close : null;
      const valueForTechnical = adjClose ?? close;
      if (valueForTechnical == null) continue;
      entries.push({
        date: row.date.toISOString().slice(0, 10),
        close,
        adjClose,
        valueForTechnical,
      });
    }
    // Sort ascending by date
    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries.length > 0 ? entries : null;
  } catch (e) {
    console.error(`[technical] fetchPriceHistory failed for ${code}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function loadOrFetchPriceHistory(code: string): Promise<{ prices: PriceHistoryEntry[]; source: 'fetched' | 'cached' } | null> {
  const histFile = path.join(PRICE_HISTORY_DIR, `${code}.json`);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Return cached if already fetched today
  if (fs.existsSync(histFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(histFile, 'utf-8')) as PriceHistoryFile;
      if (existing.lastFetchedAt?.slice(0, 10) === todayStr && existing.prices?.length > 0) {
        return { prices: existing.prices, source: 'cached' };
      }
    } catch { /* corrupt file — re-fetch */ }
  }

  // Fetch from Yahoo Finance
  const fetched = await fetchPriceHistoryFromYahoo(code);

  if (fetched && fetched.length > 0) {
    const histData: PriceHistoryFile = {
      code,
      symbol: toYahooSymbol(code),
      lastFetchedAt: new Date().toISOString(),
      prices: fetched,
    };
    try { fs.writeFileSync(histFile, JSON.stringify(histData, null, 2), 'utf-8'); } catch { /* ignore */ }
    return { prices: fetched, source: 'fetched' };
  }

  // Fetch failed — try stale cache
  if (fs.existsSync(histFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(histFile, 'utf-8')) as PriceHistoryFile;
      if (existing.prices?.length > 0) {
        console.log(`[technical] using stale cache for ${code}`);
        return { prices: existing.prices, source: 'cached' };
      }
    } catch { /* ignore */ }
  }

  return null;
}

// ── Technical: calculation ────────────────────────────────────────────────────

function calcMA(values: number[], endIdx: number, period: number): number | null {
  if (endIdx < period) return null;
  const slice = values.slice(endIdx - period, endIdx);
  if (slice.some(v => !isFinite(v) || v <= 0)) return null;
  return slice.reduce((a, b) => a + b, 0) / period;
}

const TECH_RANK_UP: Record<string, TechRating> = {
  '☆': '☆', '◎': '☆', '○': '◎', '△': '○', '×': '△', '': '',
};

function judgeTechnical(prices: PriceHistoryEntry[]): TechJudgementResult {
  const MIN_DATA = 205; // 200 for MA200 + 5 for rising-check lookback
  const n = prices.length;

  if (n < MIN_DATA) {
    return {
      rating: null, ratingBeforeBreakout: null, breakoutBoosted: false,
      reason: `データ不足(${n}件 < ${MIN_DATA}件)のため既存評価を維持`,
      status: 'insufficient_data', debug: { dataCount: n },
    };
  }

  const values = prices.map(p => p.valueForTechnical);
  const latest = values[n - 1];

  // Current MAs
  const ma5   = calcMA(values, n, 5);
  const ma25  = calcMA(values, n, 25);
  const ma50  = calcMA(values, n, 50);
  const ma75  = calcMA(values, n, 75);
  const ma200 = calcMA(values, n, 200);

  if (ma5 == null || ma25 == null || ma50 == null || ma75 == null || ma200 == null) {
    return {
      rating: null, ratingBeforeBreakout: null, breakoutBoosted: false,
      reason: 'MA計算に必要なデータ不足のため既存評価を維持',
      status: 'insufficient_data', debug: { dataCount: n, ma5, ma25, ma50, ma75, ma200 },
    };
  }

  // MAs 5 trading days ago
  const ma5_5d   = calcMA(values, n - 5, 5);
  const ma25_5d  = calcMA(values, n - 5, 25);
  const ma50_5d  = calcMA(values, n - 5, 50);
  const ma75_5d  = calcMA(values, n - 5, 75);
  const ma200_5d = calcMA(values, n - 5, 200);

  const isPerfectOrder = ma5 > ma25 && ma25 > ma50 && ma50 > ma75 && ma75 > ma200;
  const allRising = ma5_5d != null && ma25_5d != null && ma50_5d != null && ma75_5d != null && ma200_5d != null
    && ma5 > ma5_5d && ma25 > ma25_5d && ma50 > ma50_5d && ma75 > ma75_5d && ma200 > ma200_5d;

  let baseRating: TechRating;
  let reason: string;

  if (isPerfectOrder && allRising) {
    baseRating = '☆';
    reason = 'MA5>MA25>MA50>MA75>MA200 かつ全MA上昇のため☆';
  } else if (latest > ma25 && latest > ma200) {
    baseRating = '◎';
    reason = '終値が25日線と200日線を上回るため◎';
  } else if (latest > ma50 && latest > ma200) {
    baseRating = '○';
    reason = '終値が50日線と200日線を上回るため○';
  } else if (latest > ma200) {
    baseRating = '△';
    reason = '終値が200日線を上回るため△';
  } else {
    baseRating = '×';
    reason = '終値が200日線を下回るため×';
  }

  // High breakout check: recent 10 days vs prior 90 days
  const recent10 = values.slice(-10);
  const prev90 = values.slice(Math.max(0, n - 100), n - 10);
  const recentHigh = Math.max(...recent10);
  const prevHigh = prev90.length > 0 ? Math.max(...prev90) : null;
  const highBreakout = prevHigh != null && isFinite(recentHigh) && recentHigh > prevHigh;

  const debug = {
    dataCount: n, latest, ma5, ma25, ma50, ma75, ma200,
    ma5_5d, ma200_5d, isPerfectOrder, allRising,
    highBreakout, recentHigh, prevHigh,
  };

  if (highBreakout && prevHigh != null) {
    const boosted = TECH_RANK_UP[baseRating] ?? baseRating;
    const breakNote = `直近10日終値最高値(${recentHigh.toFixed(0)})が直前90日高値(${prevHigh.toFixed(0)})を上回ったため${boosted}へランクアップ`;
    reason += `。${breakNote}`;
    return { rating: boosted, ratingBeforeBreakout: baseRating, breakoutBoosted: true, reason, status: 'success', debug };
  }

  return { rating: baseRating, ratingBeforeBreakout: baseRating, breakoutBoosted: false, reason, status: 'success', debug };
}

// ── Technical: log helper ─────────────────────────────────────────────────────

function appendTechLog(entries: TechnicalLogEntry[]) {
  let existing: TechnicalLogEntry[] = [];
  if (fs.existsSync(TECH_LOG_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(TECH_LOG_FILE, 'utf-8')); } catch { existing = []; }
  }
  const merged = [...entries, ...existing].slice(0, TECH_LOG_MAX);
  fs.writeFileSync(TECH_LOG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

// ── Technical: debug single code ────────────────────────────────────────────

app.get('/api/technical/test/:code', async (req, res) => {
  const code = req.params.code.trim();
  console.log(`[technical/test] code=${code}`);
  try {
    const loaded = await loadOrFetchPriceHistory(code);
    if (!loaded) {
      res.json({ code, symbol: toYahooSymbol(code), success: false, error: 'price history unavailable', dataCount: 0, source: 'none' });
      return;
    }
    const { prices, source } = loaded;
    const result = judgeTechnical(prices);
    const n = prices.length;
    const latest = n > 0 ? prices[n - 1] : null;
    res.json({
      code, symbol: toYahooSymbol(code),
      success: result.rating != null,
      latestDate: latest?.date ?? null,
      latestClose: latest?.valueForTechnical ?? null,
      ...result.debug,
      ratingBeforeBreakout: result.ratingBeforeBreakout,
      finalRating: result.rating,
      highBreakout: result.breakoutBoosted,
      reason: result.reason,
      dataCount: n,
      source,
      error: null,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    res.json({ code, symbol: toYahooSymbol(code), success: false, error: errMsg, stack: (e instanceof Error ? e.stack : undefined) });
  }
});

// ── Technical: bulk update for a portfolio ───────────────────────────────────

app.post('/api/portfolio/:portfolioId/update-technicals', async (req, res) => {
  const { portfolioId } = req.params;
  if (!validatePortfolioId(portfolioId)) {
    res.status(400).json({ error: `Invalid portfolioId: ${portfolioId}` });
    return;
  }

  const updatedAt = new Date().toISOString();
  const pfFile = getPortfolioFile(portfolioId);

  // Backup before update
  try { createPortfolioBackup(portfolioId); } catch { /* non-fatal */ }

  let portfolio: { items: Record<string, unknown>[]; summary: unknown; lastSaved: string | null };
  try {
    portfolio = fs.existsSync(pfFile)
      ? JSON.parse(fs.readFileSync(pfFile, 'utf-8'))
      : { items: [], summary: {}, lastSaved: null };
  } catch (e) {
    res.status(500).json({ error: 'Failed to read portfolio: ' + String(e) });
    return;
  }

  const items = portfolio.items as Record<string, unknown>[];
  const targets = items.filter(i => typeof i['code'] === 'string' && (i['code'] as string).trim() !== '');

  console.log(`[technical/update] portfolioId=${portfolioId} targets=${targets.length}`);

  let successCount = 0, failedCount = 0, insufficientDataCount = 0, boostedCount = 0, cachedCount = 0;
  const results: unknown[] = [];
  const logEntries: TechnicalLogEntry[] = [];

  // Process one at a time with slight delay to avoid rate-limiting
  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    const code = (item['code'] as string).trim();
    const name = (item['name'] as string) ?? '';
    const previousTech = (item['tech'] as TechRating) ?? '';

    if (i > 0) await sleep(200);

    let judged: TechJudgementResult;
    let source: 'fetched' | 'cached' | 'none' = 'none';

    try {
      const loaded = await loadOrFetchPriceHistory(code);
      if (loaded) {
        source = loaded.source;
        judged = judgeTechnical(loaded.prices);
      } else {
        judged = {
          rating: null, ratingBeforeBreakout: null, breakoutBoosted: false,
          reason: '日足データ取得失敗のため既存評価を維持', status: 'failed', debug: {},
        };
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      judged = {
        rating: null, ratingBeforeBreakout: null, breakoutBoosted: false,
        reason: errMsg, status: 'failed', debug: {},
      };
    }

    const statusLabel = source === 'cached' && judged.status === 'success' ? 'cached' : judged.status;

    // Apply to item only on success
    if (judged.rating != null && judged.status === 'success') {
      item['tech'] = judged.rating;
      item['techAutoRating'] = judged.rating;
      item['techRatingBeforeBreakout'] = judged.ratingBeforeBreakout;
      item['techBreakoutBoosted'] = judged.breakoutBoosted;
      item['techReason'] = judged.reason;
      item['techUpdatedAt'] = updatedAt;
      item['techUpdateStatus'] = statusLabel;
      item['techUpdateError'] = null;

      if (source === 'cached') cachedCount++;
      else successCount++;
      if (judged.breakoutBoosted) boostedCount++;
    } else {
      // Keep existing tech — only update status fields
      item['techUpdateStatus'] = judged.status;
      item['techUpdateError'] = judged.reason;
      item['techUpdatedAt'] = updatedAt;

      if (judged.status === 'insufficient_data') insufficientDataCount++;
      else failedCount++;
    }

    results.push({
      code, name,
      previousTech,
      ratingBeforeBreakout: judged.ratingBeforeBreakout,
      newTech: judged.rating,
      highBreakout: judged.breakoutBoosted,
      status: statusLabel,
      reason: judged.reason,
      error: judged.status === 'failed' ? judged.reason : null,
    });

    logEntries.push({
      updatedAt, portfolioId, code, name,
      previousTech,
      ratingBeforeBreakout: judged.ratingBeforeBreakout,
      newTech: judged.rating,
      highBreakout: judged.breakoutBoosted,
      status: statusLabel as TechUpdateStatus,
      reason: judged.reason,
      error: judged.status === 'failed' ? judged.reason : null,
    });

    console.log(`[technical/update] ${code} ${name}: ${statusLabel} tech=${judged.rating ?? '(kept)'} breakout=${judged.breakoutBoosted}`);
  }

  // Save updated portfolio
  portfolio.lastSaved = updatedAt;
  try {
    fs.writeFileSync(pfFile, JSON.stringify(portfolio, null, 2), 'utf-8');
  } catch (e) {
    console.error('[technical/update] Save failed:', e);
  }

  // Save log
  try { appendTechLog(logEntries); } catch { /* non-fatal */ }

  res.json({ updatedAt, successCount, failedCount, insufficientDataCount, boostedCount, cachedCount, results });
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(3001, () => {
  console.log('API server running at http://localhost:3001');
});
