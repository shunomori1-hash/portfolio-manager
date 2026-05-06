import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import type { PriceUpdateLogEntry } from '../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'portfolio.json');
const BACKUPS_DIR = path.join(ROOT, 'data', 'backups');
const LOG_FILE = path.join(ROOT, 'data', 'price-update-log.json');
const LOG_MAX = 500;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

if (!fs.existsSync(path.join(ROOT, 'data'))) {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// ─── Yahoo Finance crumb session ──────────────────────────────────────────────
// Yahoo Finance requires a session cookie + crumb for all API calls (since 2024).
// We cache them in memory and refresh every 50 minutes or on 401.

interface YFSession {
  cookie: string;
  crumb: string;
  obtainedAt: number; // ms epoch
}

let yfSession: YFSession | null = null;
const SESSION_TTL_MS = 50 * 60 * 1000; // 50 minutes

async function getYFSession(forceRefresh = false): Promise<YFSession> {
  const now = Date.now();
  if (!forceRefresh && yfSession && (now - yfSession.obtainedAt) < SESSION_TTL_MS) {
    return yfSession;
  }

  console.log('[yf-session] Obtaining new crumb/cookie...');

  // Step 1: get Yahoo session cookie
  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });
  const rawCookies = (r1.headers.raw()['set-cookie'] ?? []) as string[];
  const cookie = rawCookies.map((c: string) => c.split(';')[0]).join('; ');

  if (!cookie) {
    throw new Error('Yahoo Finance: failed to obtain session cookie');
  }

  // Step 2: get crumb
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

// Extract the best available price from a Yahoo Finance quote object
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

// Fetch with auto session refresh on auth error
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

// ─── Other helpers ────────────────────────────────────────────────────────────

function createBackup(): string | null {
  if (!fs.existsSync(DATA_FILE)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUPS_DIR, `portfolio-${ts}.json`);
  fs.copyFileSync(DATA_FILE, backupFile);
  const backups = fs.readdirSync(BACKUPS_DIR).sort();
  if (backups.length > 30) {
    backups.slice(0, backups.length - 30).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); } catch { /* ignore */ }
    });
  }
  return backupFile;
}

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

// ── Portfolio CRUD ──────────────────────────────────────────────────────────

app.get('/api/portfolio', (_req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    res.json({ items: [], summary: { nikkeiFutures: null, topixFutures: null }, lastSaved: null });
    return;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  res.json(data);
});

app.post('/api/portfolio', (req, res) => {
  const portfolio = req.body;
  if (fs.existsSync(DATA_FILE)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUPS_DIR, `portfolio-${ts}.json`);
    fs.copyFileSync(DATA_FILE, backupFile);
    const backups = fs.readdirSync(BACKUPS_DIR).sort();
    if (backups.length > 30) {
      backups.slice(0, backups.length - 30).forEach(f => {
        try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); } catch { /* ignore */ }
      });
    }
  }
  portfolio.lastSaved = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(portfolio, null, 2), 'utf-8');
  res.json({ ok: true, lastSaved: portfolio.lastSaved });
});

// ── Backup ─────────────────────────────────────────────────────────────────

app.post('/api/backup', (_req, res) => {
  try {
    const file = createBackup();
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

    // Retry failed codes individually after a short delay
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

// ─────────────────────────────────────────────────────────────────────────────

app.listen(3001, () => {
  console.log('API server running at http://localhost:3001');
});
