import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  Portfolio, PortfolioItem, PriceFetchResponse,
  PriceUpdateLogEntry, PriceUpdateSummary,
  HedgeFutures, FuturesPosition, PortfolioId,
  FiscalMonthFetchResponse, FiscalMonthLogEntry,
  TechnicalUpdateSummary,
  CompanyNameFetchResponse, CompanyNameLogEntry,
  ValuationFetchResponse,
} from '../types';
import { saveBackup, clearBackup } from '../utils/portfolioBackup';

export const DEFAULT_HEDGE_FUTURES: HedgeFutures = {
  grossNikkei: { price: null, lots: null, multiplier: 100,   source: 'nikkei225jp',  symbol: 'c=138', lastUpdatedAt: null, updateStatus: 'unknown', updateError: null },
  nikkei:      { price: null, lots: null, multiplier: 1000,  source: 'yahoo-finance', symbol: 'NIY=F', lastUpdatedAt: null, updateStatus: 'unknown', updateError: null },
  topix:       { price: null, lots: null, multiplier: 10000, source: 'yahoo-finance', symbol: 'TPY=F', lastUpdatedAt: null, updateStatus: 'unknown', updateError: null },
};

const DEFAULT_PORTFOLIO: Portfolio = {
  items: [],
  summary: {
    nikkeiFutures: null,
    topixFutures: null,
    totalAssets: null,
    hedgeFutures: DEFAULT_HEDGE_FUTURES,
  },
  lastSaved: null,
};

// Returns true when name has a meaningful value (not empty / dash)
function isNameFilled(name: string | undefined | null): boolean {
  if (!name) return false;
  const n = name.trim();
  return n !== '' && n !== '-' && n !== '—';
}

// Returns true when the name field may be auto-overwritten.
// Blank names, Yahoo-fetched names, and JPX-fetched names are writable.
// Manual/import/override-tagged names are protected.
function isNameWritable(item: PortfolioItem): boolean {
  if (!isNameFilled(item.name)) return true;
  return item.nameSource === 'yahoo' || item.nameSource === 'jpx';
}

// Returns true when settlementMonth has a meaningful value (not empty / dash)
function isSettlementMonthFilled(month: string | undefined | null): boolean {
  if (!month) return false;
  const m = month.trim();
  return m !== '' && m !== '-' && m !== '—';
}

// Ensure every item has all required fields (backwards compat with old portfolio.json)
function normalizeItem(raw: Partial<PortfolioItem>): PortfolioItem {
  return {
    id: raw.id ?? crypto.randomUUID(),
    code: raw.code ?? '',
    name: raw.name ?? '',
    price: raw.price ?? null,
    shares: raw.shares ?? null,
    plannedShares: 'plannedShares' in raw ? (raw.plannedShares ?? null) : (raw.shares ?? null),
    plannedDelta: raw.plannedDelta ?? null,
    settlementMonth: raw.settlementMonth ?? '',
    tech: raw.tech ?? '',
    topix: raw.topix ?? '',
    borderPrice: raw.borderPrice ?? null,
    targetPrice: raw.targetPrice ?? null,
    targetPeriod: raw.targetPeriod ?? '',
    fx: raw.fx ?? '',
    inflation: raw.inflation ?? '',
    ir: raw.ir ?? '',
    per: raw.per ?? null,
    management: raw.management ?? '',
    competitiveness: raw.competitiveness ?? '',
    governance: raw.governance ?? '',
    netCash: raw.netCash ?? null,
    marchDividend: raw.marchDividend ?? null,
    dividend: raw.dividend ?? null,
    benefit: raw.benefit ?? null,
    memo: raw.memo ?? '',
    tag: raw.tag ?? '',
    priceUpdatedAt: raw.priceUpdatedAt ?? null,
    priceError: raw.priceError ?? null,
    priceUpdateStatus: raw.priceUpdateStatus ?? 'unknown',
    previousPrice: raw.previousPrice ?? null,
    // fiscal month tracking — default to 'unknown' for old data
    fiscalMonthUpdateStatus: raw.fiscalMonthUpdateStatus ?? 'unknown',
    fiscalMonthUpdateError: raw.fiscalMonthUpdateError ?? null,
    lastFiscalMonthUpdatedAt: raw.lastFiscalMonthUpdatedAt ?? null,
    // company name auto-fill tracking
    // Existing items without nameSource: treat filled names as 'manual' so they won't be overwritten
    nameSource: raw.nameSource ?? (raw.name?.trim() ? 'manual' : 'unknown'),
    nameUpdateStatus: raw.nameUpdateStatus ?? 'unknown',
    nameUpdateError: raw.nameUpdateError ?? null,
    nameUpdatedAt: raw.nameUpdatedAt ?? null,
    // technical auto-rating — default to 'unknown' for old data
    techAutoRating: raw.techAutoRating ?? '',
    techRatingBeforeBreakout: raw.techRatingBeforeBreakout ?? null,
    techBreakoutBoosted: raw.techBreakoutBoosted ?? false,
    techReason: raw.techReason ?? '',
    techUpdatedAt: raw.techUpdatedAt ?? null,
    techUpdateStatus: raw.techUpdateStatus ?? 'unknown',
    techUpdateError: raw.techUpdateError ?? null,
    // valuation (PBR / ROE) — default to null for old data
    pbr: raw.pbr ?? null,
    roe: raw.roe ?? null,
    valuationUpdatedAt: raw.valuationUpdatedAt ?? null,
    valuationUpdateStatus: raw.valuationUpdateStatus ?? 'unknown',
    valuationUpdateError: raw.valuationUpdateError ?? null,
  };
}

function normalizeFuturesPos(raw?: Partial<FuturesPosition> | null, def?: FuturesPosition): FuturesPosition {
  const d = def ?? DEFAULT_HEDGE_FUTURES.grossNikkei;
  return {
    price:         raw?.price         ?? null,
    lots:          raw?.lots          ?? null,
    multiplier:    raw?.multiplier    ?? d.multiplier,
    source:        raw?.source        ?? d.source,
    symbol:        raw?.symbol        ?? d.symbol,
    lastUpdatedAt: raw?.lastUpdatedAt ?? null,
    updateStatus:  raw?.updateStatus  ?? 'unknown',
    updateError:   raw?.updateError   ?? null,
  };
}

function normalizeHedgeFutures(raw?: Partial<HedgeFutures> | null): HedgeFutures {
  const def = DEFAULT_HEDGE_FUTURES;
  return {
    grossNikkei: normalizeFuturesPos(raw?.grossNikkei, def.grossNikkei),
    nikkei:      normalizeFuturesPos(raw?.nikkei,      def.nikkei),
    topix:       normalizeFuturesPos(raw?.topix,       def.topix),
  };
}

function normalizePortfolio(raw: Partial<Portfolio>): Portfolio {
  return {
    items: (raw.items ?? []).map(normalizeItem),
    summary: {
      nikkeiFutures:  raw.summary?.nikkeiFutures  ?? null,
      topixFutures:   raw.summary?.topixFutures   ?? null,
      totalAssets:    raw.summary?.totalAssets    ?? null,
      hedgeFutures:   normalizeHedgeFutures(raw.summary?.hedgeFutures),
    },
    lastSaved: raw.lastSaved ?? null,
  };
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch {
    throw new Error('APIサーバーが起動していません。PF管理起動.bat を再実行してください。');
  }
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error('APIサーバーが起動していません。PF管理起動.bat を再実行してください。');
  }
  return r.json() as Promise<T>;
}

// Fire-and-forget log post
function postPriceLog(entries: PriceUpdateLogEntry[]) {
  if (!entries.length) return;
  fetch('/api/prices/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => { /* best-effort */ });
}

function postFiscalMonthLog(entries: FiscalMonthLogEntry[]) {
  if (!entries.length) return;
  fetch('/api/fiscal-month/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => { /* best-effort */ });
}

function postCompanyNameLog(entries: CompanyNameLogEntry[]) {
  if (!entries.length) return;
  fetch('/api/company-name/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => { /* best-effort */ });
}

interface FuturesUpdateResult {
  key: keyof HedgeFutures;
  name: string;
  source: string;
  symbol: string;
  price: number | null;
  status: 'success' | 'failed';
  error: string | null;
}

interface FuturesUpdateResponse {
  results: FuturesUpdateResult[];
  updatedAt: string;
  successCount: number;
  failedCount: number;
}

export function usePortfolio(portfolioId: PortfolioId) {
  const [portfolio, setPortfolio] = useState<Portfolio>(DEFAULT_PORTFOLIO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [fetchingFutures, setFetchingFutures] = useState(false);
  const [fetchingTechnicals, setFetchingTechnicals] = useState(false);
  const [technicalUpdateSummary, setTechnicalUpdateSummary] = useState<TechnicalUpdateSummary | null>(null);
  const [fetchingPriceItemId, setFetchingPriceItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [priceUpdateSummary, setPriceUpdateSummary] = useState<PriceUpdateSummary | null>(null);

  // ── Auto-backup dirty state to localStorage (2 s debounce) ───────────────
  const autoBackupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isDirty) return;
    if (autoBackupTimer.current) clearTimeout(autoBackupTimer.current);
    autoBackupTimer.current = setTimeout(() => {
      saveBackup(portfolioId, portfolio, 'auto_dirty');
    }, 2000);
    return () => {
      if (autoBackupTimer.current) clearTimeout(autoBackupTimer.current);
    };
  }, [portfolio, isDirty, portfolioId]);

  // ── Load (re-runs on portfolioId change) ──────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setPortfolio(DEFAULT_PORTFOLIO);
    setIsDirty(false);
    setError(null);
    setSaveStatus(null);
    setPriceUpdateSummary(null);

    apiJson<Partial<Portfolio>>(`/api/portfolio/${portfolioId}`)
      .then((raw) => {
        setPortfolio(normalizePortfolio(raw));
        setLoading(false);
      })
      .catch(e => {
        setError(String(e));
        setLoading(false);
      });
  }, [portfolioId]);

  // ── Basic CRUD ────────────────────────────────────────────────────────────
  const updateItem = useCallback((id: string, updates: Partial<PortfolioItem>) => {
    setPortfolio(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, ...updates } : item),
    }));
    setIsDirty(true);
  }, []);

  const updatePriceManually = useCallback((id: string, newPrice: number | null) => {
    const now = new Date().toISOString();
    setPortfolio(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.id !== id) return item;
        return {
          ...item,
          previousPrice: item.price,
          price: newPrice,
          priceUpdatedAt: now,
          priceUpdateStatus: 'manual',
          priceError: null,
        };
      }),
    }));
    setIsDirty(true);
  }, []);

  const updateSummary = useCallback((updates: Partial<Portfolio['summary']>) => {
    setPortfolio(prev => ({ ...prev, summary: { ...prev.summary, ...updates } }));
    setIsDirty(true);
  }, []);

  const resetPlannedShares = useCallback(() => {
    setPortfolio(prev => ({
      ...prev,
      items: prev.items.map(item => ({ ...item, plannedShares: item.shares })),
    }));
    setIsDirty(true);
  }, []);

  const addItem = useCallback((initial: Partial<PortfolioItem> = {}) => {
    const newItem = normalizeItem({ ...initial, id: crypto.randomUUID() });
    setPortfolio(prev => ({ ...prev, items: [...prev.items, newItem] }));
    setIsDirty(true);
    // Save hand-entered name to master so future auto-fill can use it
    if (newItem.code.trim() && newItem.name.trim()) {
      fetch('/api/company-name/master/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: newItem.code.trim(), name: newItem.name.trim() }),
      }).catch(() => { /* best-effort */ });
    }
  }, []);

  const removeItem = useCallback((id: string) => {
    setPortfolio(prev => ({ ...prev, items: prev.items.filter(item => item.id !== id) }));
    setIsDirty(true);
  }, []);

  // ── Restore from local backup ─────────────────────────────────────────────
  const restorePortfolio = useCallback((data: Portfolio) => {
    setPortfolio(normalizePortfolio(data));
    setIsDirty(true);
    clearBackup(portfolioId);
    setSaveStatus('ブラウザ内バックアップから復元しました。保存ボタンで保存してください。');
    setTimeout(() => setSaveStatus(null), 5000);
  }, [portfolioId]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = useCallback(async (current: Portfolio) => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const data = await apiJson<{ ok: boolean; lastSaved: string }>(`/api/portfolio/${portfolioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      });
      setPortfolio(prev => ({ ...prev, lastSaved: data.lastSaved }));
      setIsDirty(false);
      clearBackup(portfolioId); // saved to server — no longer need local backup
      setSaveStatus('保存しました');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      // Preserve data in localStorage so it isn't lost when the API is down
      saveBackup(portfolioId, current, 'save_failed_api_offline');
      setSaveStatus(
        'APIサーバーが起動していないため保存できません。' +
        'PF管理起動.bat を再実行後、もう一度保存してください。' +
        '現在の変更内容はブラウザ内に一時保存しました。'
      );
    } finally {
      setSaving(false);
    }
  }, [portfolioId]);

  // ── Import ────────────────────────────────────────────────────────────────
  const importItems = useCallback(async (items: PortfolioItem[]) => {
    setSaving(true);
    setSaveStatus(null);
    let newPortfolio: Portfolio | null = null;
    setPortfolio(prev => {
      newPortfolio = { ...prev, items };
      return newPortfolio;
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    try {
      if (!newPortfolio) throw new Error('state error');
      const data = await apiJson<{ ok: boolean; lastSaved: string }>(`/api/portfolio/${portfolioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPortfolio),
      });
      setPortfolio(prev => ({ ...prev, lastSaved: data.lastSaved }));
      setIsDirty(false);
      setSaveStatus('インポート完了');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      setSaving(false);
      throw new Error('JSON保存に失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    }
    setSaving(false);
  }, [portfolioId]);

  // ── Bulk price fetch (+ fiscal month auto-fill for blank entries) ─────────
  const fetchPrices = useCallback(async (current: Portfolio) => {
    const targets = current.items.filter(i => i.code.trim() !== '');
    if (!targets.length) return;

    setFetchingPrices(true);
    setPriceUpdateSummary(null);

    // 1. Backup before fetch
    try {
      await fetch(`/api/portfolio/${portfolioId}/backup`, { method: 'POST' });
    } catch { /* backup failure is non-fatal */ }

    // 2. Fetch stock prices
    const codes = targets.map(i => i.code);
    let priceResults: PriceFetchResponse['results'] = [];
    let updatedAt = new Date().toISOString();

    try {
      const data = await apiJson<PriceFetchResponse>('/api/prices/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      priceResults = data.results;
      updatedAt = data.updatedAt;
    } catch (e) {
      setError('株価取得エラー: ' + String(e));
      setFetchingPrices(false);
      return;
    }

    // 3. Apply price results to compute new items
    const priceLogEntries: PriceUpdateLogEntry[] = [];
    let newItems = current.items.map(item => {
      if (!item.code.trim()) {
        return { ...item, priceUpdateStatus: 'skipped' as const };
      }
      const result = priceResults.find(r => r.code === item.code);
      if (!result) return item;

      if (result.price != null && isFinite(result.price)) {
        priceLogEntries.push({
          timestamp: updatedAt, code: item.code, name: item.name,
          prevPrice: item.price, newPrice: result.price, status: 'success', error: null,
        });
        return {
          ...item,
          previousPrice: item.price,
          price: result.price,
          priceUpdatedAt: updatedAt,
          priceError: null,
          priceUpdateStatus: 'success' as const,
        };
      } else {
        const errMsg = result.error ?? '取得失敗';
        priceLogEntries.push({
          timestamp: updatedAt, code: item.code, name: item.name,
          prevPrice: item.price, newPrice: null, status: 'failed', error: errMsg,
        });
        return {
          ...item,
          // price NOT changed on failure
          priceError: errMsg,
          priceUpdatedAt: updatedAt,
          priceUpdateStatus: 'failed' as const,
        };
      }
    });

    const finalPriceSuccess = priceResults.filter(r => r.price != null && isFinite(r.price)).length;
    const finalPriceFailed  = priceResults.filter(r => r.price == null).length;
    const finalPriceSkipped = current.items.filter(i => !i.code.trim()).length;

    // 4. Fiscal month auto-fill — only for items with blank settlementMonth
    const blankMonthItems = newItems.filter(
      i => i.code.trim() !== '' && !isSettlementMonthFilled(i.settlementMonth)
    );
    const fmSkippedCount = newItems.filter(
      i => i.code.trim() !== '' && isSettlementMonthFilled(i.settlementMonth)
    ).length;

    let fmSuccessCount = 0;
    let fmFailedCount = 0;
    const fmLogEntries: FiscalMonthLogEntry[] = [];

    if (blankMonthItems.length > 0) {
      const fmCodes = blankMonthItems.map(i => i.code);
      try {
        const fmData = await apiJson<FiscalMonthFetchResponse>('/api/fiscal-months/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codes: fmCodes }),
        });
        const fmFetchedAt = fmData.fetchedAt;

        fmSuccessCount = fmData.results.filter(r => r.monthStr != null).length;
        fmFailedCount  = fmData.results.filter(r => r.monthStr == null).length;

        // Apply fiscal month results — ONLY write to currently-blank fields
        newItems = newItems.map(item => {
          if (!item.code.trim() || isSettlementMonthFilled(item.settlementMonth)) {
            return item; // already filled — never overwrite
          }
          const result = fmData.results.find(r => r.code === item.code);
          if (!result) return item;

          if (result.monthStr != null) {
            fmLogEntries.push({
              updatedAt: fmFetchedAt, portfolioId, code: item.code, name: item.name,
              previousFiscalMonth: item.settlementMonth,
              newFiscalMonth: result.monthStr,
              status: 'success', source: result.source, error: null,
            });
            return {
              ...item,
              settlementMonth: result.monthStr,
              fiscalMonthUpdateStatus: 'success' as const,
              fiscalMonthUpdateError: null,
              lastFiscalMonthUpdatedAt: fmFetchedAt,
            };
          } else {
            fmLogEntries.push({
              updatedAt: fmFetchedAt, portfolioId, code: item.code, name: item.name,
              previousFiscalMonth: item.settlementMonth,
              newFiscalMonth: null,
              status: 'failed', source: result.source, error: result.error ?? '取得失敗',
            });
            return {
              ...item,
              // settlementMonth NOT changed on failure
              fiscalMonthUpdateStatus: 'failed' as const,
              fiscalMonthUpdateError: result.error ?? '取得失敗',
              lastFiscalMonthUpdatedAt: fmFetchedAt,
            };
          }
        });

        postFiscalMonthLog(fmLogEntries);
      } catch { /* fiscal month fetch is non-fatal — ignore */ }
    }

    // 5. Company name: lookup from overrides → JPX master for writable items
    //    Writable = blank name OR nameSource is yahoo/jpx
    //    Protected = manual/import/override
    let cnFilledCount = 0;       // blank → filled
    let cnCorrectionCount = 0;   // yahoo/jpx-named → corrected
    let cnUnregisteredCount = 0; // blank → stayed blank (not in overrides/master)
    let cnSkippedCount = 0;      // had manual/import name → not touched
    const cnLogEntries: CompanyNameLogEntry[] = [];

    const writableItems = newItems.filter(i => i.code.trim() !== '' && isNameWritable(i));
    cnSkippedCount = newItems.filter(i => i.code.trim() !== '' && !isNameWritable(i)).length;

    if (writableItems.length > 0) {
      const cnCodes = writableItems.map(i => i.code);
      try {
        const cnData = await apiJson<CompanyNameFetchResponse>('/api/company-names/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codes: cnCodes }),
        });
        const cnFetchedAt = cnData.fetchedAt;

        newItems = newItems.map(item => {
          if (!item.code.trim() || !isNameWritable(item)) return item;
          const result = cnData.results.find(r => r.code === item.code);
          if (!result) return item;

          if (result.name != null) {
            const wasBlank = !isNameFilled(item.name);
            if (wasBlank) cnFilledCount++; else cnCorrectionCount++;
            const newSource = (result.source === 'override' ? 'override' : 'jpx') as 'override' | 'jpx';
            cnLogEntries.push({
              updatedAt: cnFetchedAt, portfolioId, code: item.code,
              previousName: item.name, newName: result.name,
              status: 'success', source: newSource, error: null,
            });
            return {
              ...item,
              name: result.name,
              nameSource: newSource,
              nameUpdateStatus: 'success' as const,
              nameUpdateError: null,
              nameUpdatedAt: cnFetchedAt,
            };
          } else {
            // Not in overrides/master — do NOT use Yahoo; blank stays blank
            if (!isNameFilled(item.name)) cnUnregisteredCount++;
            return item;
          }
        });
      } catch { /* non-fatal */ }
    }

    postCompanyNameLog(cnLogEntries);

    // 7. Valuation fetch (PER / PBR / ROE) — non-fatal
    let valSuccessCount = 0;
    let valPartialCount = 0;
    let valFailedCount = 0;
    const valuationCodes = targets.map(i => i.code);
    try {
      const valData = await apiJson<ValuationFetchResponse>('/api/valuation/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: valuationCodes }),
      });
      const valFetchedAt = valData.fetchedAt;

      newItems = newItems.map(item => {
        if (!item.code.trim()) return item;
        const result = valData.results.find(r => r.code === item.code);
        if (!result) return item;

        const updates: Partial<PortfolioItem> = {
          valuationUpdatedAt: valFetchedAt,
          valuationUpdateStatus: result.status as 'success' | 'partial' | 'failed',
          valuationUpdateError: result.error ?? null,
        };

        // Only update if new value is a valid finite number (protect existing values)
        if (result.per != null && isFinite(result.per)) updates.per = result.per;
        if (result.pbr != null && isFinite(result.pbr)) updates.pbr = result.pbr;
        if (result.roe != null && isFinite(result.roe)) updates.roe = result.roe;

        if (result.status === 'success') valSuccessCount++;
        else if (result.status === 'partial') valPartialCount++;
        else valFailedCount++;

        return { ...item, ...updates };
      });
    } catch (e) {
      console.warn('[fetchPrices] valuation fetch failed (non-fatal):', e);
    }

    // 8. Set summary
    const summary: PriceUpdateSummary = {
      updatedAt,
      successCount: finalPriceSuccess,
      failedCount: finalPriceFailed,
      skippedCount: finalPriceSkipped,
      failedItems: priceResults
        .filter(r => r.price == null)
        .map(r => {
          const item = current.items.find(i => i.code === r.code);
          return { code: r.code, name: item?.name ?? '', error: r.error ?? '取得失敗' };
        }),
      fiscalMonth: {
        successCount: fmSuccessCount,
        failedCount: fmFailedCount,
        skippedCount: fmSkippedCount,
      },
      companyName: {
        filledCount: cnFilledCount,
        correctionCount: cnCorrectionCount,
        unregisteredCount: cnUnregisteredCount,
        skippedCount: cnSkippedCount,
      },
      valuation: {
        successCount: valSuccessCount,
        partialCount: valPartialCount,
        failedCount: valFailedCount,
      },
    };
    setPriceUpdateSummary(summary);

    // 8. Post price log
    postPriceLog(priceLogEntries);

    // 9. Apply all updates to state at once
    const updatedPortfolio = { ...current, items: newItems };
    setPortfolio(updatedPortfolio);
    setIsDirty(true);

    // 8. Auto-save
    setTimeout(async () => {
      try {
        const saveData = await apiJson<{ ok: boolean; lastSaved: string }>(`/api/portfolio/${portfolioId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedPortfolio),
        });
        setPortfolio(p => ({ ...p, lastSaved: saveData.lastSaved }));
        setIsDirty(false);

        let statusMsg = `株価更新 成功${finalPriceSuccess}件`;
        if (finalPriceFailed > 0) statusMsg += ` 失敗${finalPriceFailed}件`;
        if (blankMonthItems.length > 0) {
          statusMsg += ` / 決算月補完 成功${fmSuccessCount}件`;
          if (fmFailedCount > 0) statusMsg += ` 失敗${fmFailedCount}件`;
          statusMsg += ` スキップ${fmSkippedCount}件`;
        }
        if (writableItems.length > 0 || cnCorrectionCount > 0) {
          statusMsg += ` / 銘柄名補完 成功${cnFilledCount}件`;
          if (cnCorrectionCount > 0) statusMsg += ` 補正${cnCorrectionCount}件`;
          if (cnUnregisteredCount > 0) statusMsg += ` 未登録${cnUnregisteredCount}件`;
          statusMsg += ` スキップ${cnSkippedCount}件`;
        }
        if (valSuccessCount + valPartialCount + valFailedCount > 0) {
          statusMsg += ` / 指標更新 成功${valSuccessCount}件`;
          if (valPartialCount > 0) statusMsg += ` 一部成功${valPartialCount}件`;
          if (valFailedCount > 0) statusMsg += ` 失敗${valFailedCount}件`;
        }
        setSaveStatus(statusMsg);
        setTimeout(() => setSaveStatus(null), 6000);
      } catch { /* auto-save failure is non-fatal */ }
    }, 0);

    setFetchingPrices(false);
  }, [portfolioId]);

  // ── Single price fetch ────────────────────────────────────────────────────
  const fetchSinglePrice = useCallback(async (itemId: string, code: string) => {
    if (!code.trim()) return;
    setFetchingPriceItemId(itemId);

    try {
      const data = await apiJson<PriceFetchResponse>('/api/prices/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: [code] }),
      });
      const result = data.results[0];

      setPortfolio(prev => {
        const item = prev.items.find(i => i.id === itemId);
        if (!item) return prev;

        if (result?.price != null && isFinite(result.price)) {
          postPriceLog([{
            timestamp: data.updatedAt, code, name: item.name,
            prevPrice: item.price, newPrice: result.price, status: 'success', error: null,
          }]);
          return {
            ...prev,
            items: prev.items.map(i => i.id === itemId ? {
              ...i,
              previousPrice: i.price,
              price: result.price,
              priceUpdatedAt: data.updatedAt,
              priceError: null,
              priceUpdateStatus: 'success' as const,
            } : i),
          };
        } else {
          const errMsg = result?.error ?? '取得失敗';
          postPriceLog([{
            timestamp: data.updatedAt, code, name: item.name,
            prevPrice: item.price, newPrice: null, status: 'failed', error: errMsg,
          }]);
          return {
            ...prev,
            items: prev.items.map(i => i.id === itemId ? {
              ...i,
              priceError: errMsg,
              priceUpdatedAt: data.updatedAt,
              priceUpdateStatus: 'failed' as const,
            } : i),
          };
        }
      });
      setIsDirty(true);
    } catch (e) {
      const errMsg = String(e);
      setPortfolio(prev => ({
        ...prev,
        items: prev.items.map(i => i.id === itemId ? {
          ...i,
          priceError: errMsg,
          priceUpdateStatus: 'failed' as const,
        } : i),
      }));
    } finally {
      setFetchingPriceItemId(null);
    }
  }, []);

  // ── Fetch futures prices ──────────────────────────────────────────────────
  const fetchFuturesPrices = useCallback(async () => {
    setFetchingFutures(true);
    const now = new Date().toISOString();
    try {
      const data = await apiJson<FuturesUpdateResponse>('/api/futures-prices/update', { method: 'POST' });

      setPortfolio(prev => {
        const hf = { ...prev.summary.hedgeFutures };
        for (const result of data.results) {
          const k = result.key;
          const pos = hf[k];
          if (result.status === 'success' && result.price != null && isFinite(result.price)) {
            hf[k] = { ...pos, price: result.price, updateStatus: 'success', updateError: null, lastUpdatedAt: data.updatedAt };
          } else {
            hf[k] = { ...pos, updateStatus: 'failed', updateError: result.error ?? '取得失敗', lastUpdatedAt: now };
          }
        }
        return { ...prev, summary: { ...prev.summary, hedgeFutures: hf } };
      });
      setIsDirty(true);
    } catch (e) {
      setPortfolio(prev => {
        const hf = { ...prev.summary.hedgeFutures };
        const errMsg = e instanceof Error ? e.message : String(e);
        for (const k of Object.keys(hf) as (keyof HedgeFutures)[]) {
          hf[k] = { ...hf[k], updateStatus: 'failed', updateError: errMsg, lastUpdatedAt: now };
        }
        return { ...prev, summary: { ...prev.summary, hedgeFutures: hf } };
      });
    } finally {
      setFetchingFutures(false);
    }
  }, []);

  // ── Fetch technical ratings ───────────────────────────────────────────────
  const fetchTechnicals = useCallback(async () => {
    setFetchingTechnicals(true);
    setTechnicalUpdateSummary(null);
    try {
      const data = await apiJson<TechnicalUpdateSummary>(`/api/portfolio/${portfolioId}/update-technicals`, { method: 'POST' });
      setTechnicalUpdateSummary(data);

      // Reload portfolio to reflect server-side changes
      const reloaded = await apiJson<Partial<Portfolio>>(`/api/portfolio/${portfolioId}`);
      setPortfolio(normalizePortfolio(reloaded));
      setIsDirty(false);

      const { successCount, cachedCount, insufficientDataCount, failedCount, boostedCount } = data;
      const total = successCount + cachedCount;
      let msg = `テク更新 成功${total}件`;
      if (insufficientDataCount > 0) msg += ` データ不足${insufficientDataCount}件`;
      if (failedCount > 0) msg += ` 失敗${failedCount}件`;
      if (boostedCount > 0) msg += ` 高値ブレイク${boostedCount}件`;
      setSaveStatus(msg);
      setTimeout(() => setSaveStatus(null), 6000);
    } catch (e) {
      setSaveStatus('テク更新エラー: ' + String(e));
      setTimeout(() => setSaveStatus(null), 5000);
    } finally {
      setFetchingTechnicals(false);
    }
  }, [portfolioId]);

  return {
    portfolio,
    loading,
    saving,
    fetchingPrices,
    fetchingFutures,
    fetchingTechnicals,
    fetchingPriceItemId,
    error,
    saveStatus,
    isDirty,
    priceUpdateSummary,
    technicalUpdateSummary,
    updateItem,
    updatePriceManually,
    resetPlannedShares,
    updateSummary,
    addItem,
    removeItem,
    save,
    restorePortfolio,
    fetchPrices,
    fetchSinglePrice,
    fetchFuturesPrices,
    fetchTechnicals,
    importItems,
  };
}
