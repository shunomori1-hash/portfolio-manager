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

// Ensure directories exist
if (!fs.existsSync(path.join(ROOT, 'data'))) {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createBackup(): string | null {
  if (!fs.existsSync(DATA_FILE)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUPS_DIR, `portfolio-${ts}.json`);
  fs.copyFileSync(DATA_FILE, backupFile);
  // Keep last 30 backups
  const backups = fs.readdirSync(BACKUPS_DIR).sort();
  if (backups.length > 30) {
    backups.slice(0, backups.length - 30).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); } catch { /* ignore */ }
    });
  }
  return backupFile;
}

// Convert a stock code to Yahoo Finance symbol, avoiding duplicate .T
function toYahooSymbol(code: string): string {
  return code.endsWith('.T') ? code : `${code}.T`;
}

// Fetch prices from Yahoo Finance for a batch of codes
async function fetchFromYahoo(codes: string[]): Promise<Array<{ code: string; price: number | null; error: string | null }>> {
  const symbols = codes.map(toYahooSymbol).join(',');
  const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,shortName`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'ja,en;q=0.9',
    },
    // 10 second timeout
    signal: AbortSignal.timeout(10000),
  } as Parameters<typeof fetch>[1]);

  if (!response.ok) {
    throw new Error(`Yahoo Finance HTTP ${response.status}`);
  }

  const data = await response.json() as {
    quoteResponse?: { result?: Array<{ symbol: string; regularMarketPrice?: number }> };
  };
  const quotes = data?.quoteResponse?.result ?? [];

  return codes.map(code => {
    const symbol = toYahooSymbol(code);
    const quote = quotes.find(q => q.symbol === symbol);
    if (quote?.regularMarketPrice != null && isFinite(quote.regularMarketPrice)) {
      return { code, price: quote.regularMarketPrice, error: null };
    }
    return { code, price: null, error: 'データ取得失敗' };
  });
}

// Append entries to price update log
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

// ── Manual backup endpoint ──────────────────────────────────────────────────

app.post('/api/backup', (_req, res) => {
  try {
    const file = createBackup();
    res.json({ ok: true, file });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// ── Price fetch ─────────────────────────────────────────────────────────────

app.post('/api/prices/fetch', async (req, res) => {
  const { codes } = req.body as { codes: string[] };
  const updatedAt = new Date().toISOString();

  if (!codes || codes.length === 0) {
    res.json({ results: [], updatedAt });
    return;
  }

  let results: Array<{ code: string; price: number | null; error: string | null }>;

  try {
    // Batch 1: fetch all at once
    results = await fetchFromYahoo(codes);

    // Batch 2: retry codes that failed, individually, after a short delay
    const failed = results.filter(r => r.price == null);
    if (failed.length > 0 && failed.length < codes.length) {
      await sleep(600);
      const retried = await Promise.allSettled(
        failed.map(async f => {
          await sleep(100); // small stagger
          return fetchFromYahoo([f.code]).then(r => r[0]);
        })
      );
      retried.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.price != null) {
          const idx = results.findIndex(x => x.code === failed[i].code);
          if (idx >= 0) results[idx] = r.value;
        }
      });
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('Price batch fetch error:', errMsg);
    // Full retry after 1.5s
    await sleep(1500);
    try {
      results = await fetchFromYahoo(codes);
    } catch (e2) {
      const errMsg2 = e2 instanceof Error ? e2.message : String(e2);
      console.error('Price batch retry error:', errMsg2);
      results = codes.map(code => ({ code, price: null, error: errMsg2 }));
    }
  }

  res.json({ results, updatedAt });
});

// ── Price update log ────────────────────────────────────────────────────────

app.get('/api/prices/log', (_req, res) => {
  if (!fs.existsSync(LOG_FILE)) {
    res.json({ entries: [] });
    return;
  }
  try {
    const entries = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    res.json({ entries });
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
