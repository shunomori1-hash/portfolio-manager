import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'portfolio.json');
const BACKUPS_DIR = path.join(ROOT, 'data', 'backups');

if (!fs.existsSync(path.join(ROOT, 'data'))) {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
    if (backups.length > 20) {
      backups.slice(0, backups.length - 20).forEach(f => {
        fs.unlinkSync(path.join(BACKUPS_DIR, f));
      });
    }
  }

  portfolio.lastSaved = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(portfolio, null, 2), 'utf-8');
  res.json({ ok: true, lastSaved: portfolio.lastSaved });
});

app.post('/api/prices/fetch', async (req, res) => {
  const { codes } = req.body as { codes: string[] };
  const symbols = codes.map(c => `${c}.T`).join(',');
  const updatedAt = new Date().toISOString();

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,shortName`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance HTTP ${response.status}`);
    }

    const data = await response.json() as { quoteResponse?: { result?: Array<{ symbol: string; regularMarketPrice?: number }> } };
    const quotes = data?.quoteResponse?.result ?? [];

    const results = codes.map(code => {
      const quote = quotes.find(q => q.symbol === `${code}.T`);
      if (quote?.regularMarketPrice != null) {
        return { code, price: quote.regularMarketPrice, error: null };
      }
      return { code, price: null, error: 'データ取得失敗' };
    });

    res.json({ results, updatedAt });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('Price fetch error:', error);
    res.json({
      results: codes.map(code => ({ code, price: null, error })),
      updatedAt,
      error,
    });
  }
});

app.listen(3001, () => {
  console.log('API server running at http://localhost:3001');
});
