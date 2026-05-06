import { useState, useCallback, useEffect } from 'react';
import type {
  Portfolio, PortfolioItem, PriceFetchResponse,
  PriceUpdateLogEntry, PriceUpdateSummary,
} from '../types';

const DEFAULT_PORTFOLIO: Portfolio = {
  items: [],
  summary: { nikkeiFutures: null, topixFutures: null },
  lastSaved: null,
};

// Ensure every item has the new fields (backwards compat with old portfolio.json)
function normalizeItem(raw: Partial<PortfolioItem>): PortfolioItem {
  return {
    id: raw.id ?? crypto.randomUUID(),
    code: raw.code ?? '',
    name: raw.name ?? '',
    price: raw.price ?? null,
    shares: raw.shares ?? null,
    // plannedShares defaults to current shares when not present in saved data
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
  };
}

function normalizePortfolio(raw: Partial<Portfolio>): Portfolio {
  return {
    items: (raw.items ?? []).map(normalizeItem),
    summary: raw.summary ?? { nikkeiFutures: null, topixFutures: null },
    lastSaved: raw.lastSaved ?? null,
  };
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

export function usePortfolio() {
  const [portfolio, setPortfolio] = useState<Portfolio>(DEFAULT_PORTFOLIO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [fetchingPriceItemId, setFetchingPriceItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [priceUpdateSummary, setPriceUpdateSummary] = useState<PriceUpdateSummary | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then((raw: Partial<Portfolio>) => {
        setPortfolio(normalizePortfolio(raw));
        setLoading(false);
      })
      .catch(e => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  // ── Basic CRUD ────────────────────────────────────────────────────────────
  const updateItem = useCallback((id: string, updates: Partial<PortfolioItem>) => {
    setPortfolio(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, ...updates } : item),
    }));
    setIsDirty(true);
  }, []);

  // Manual price update: tracks previousPrice and sets status='manual'
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
  }, []);

  const removeItem = useCallback((id: string) => {
    setPortfolio(prev => ({ ...prev, items: prev.items.filter(item => item.id !== id) }));
    setIsDirty(true);
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = useCallback(async (current: Portfolio) => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const r = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      });
      const data = await r.json() as { ok: boolean; lastSaved: string };
      setPortfolio(prev => ({ ...prev, lastSaved: data.lastSaved }));
      setIsDirty(false);
      setSaveStatus('保存しました');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      setSaveStatus('保存失敗: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, []);

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
      const r = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPortfolio),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { ok: boolean; lastSaved: string };
      setPortfolio(prev => ({ ...prev, lastSaved: data.lastSaved }));
      setIsDirty(false);
      setSaveStatus('インポート完了');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      setSaving(false);
      throw new Error('JSON保存に失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    }
    setSaving(false);
  }, []);

  // ── Bulk price fetch ──────────────────────────────────────────────────────
  const fetchPrices = useCallback(async (current: Portfolio) => {
    const targets = current.items.filter(i => i.code.trim() !== '');
    if (!targets.length) return;

    setFetchingPrices(true);
    setPriceUpdateSummary(null);

    // 1. Backup before fetch
    try {
      await fetch('/api/backup', { method: 'POST' });
    } catch { /* backup failure is non-fatal */ }

    // 2. Fetch prices
    const codes = targets.map(i => i.code);
    let results: PriceFetchResponse['results'] = [];
    let updatedAt = new Date().toISOString();

    try {
      const r = await fetch('/api/prices/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      const data = await r.json() as PriceFetchResponse;
      results = data.results;
      updatedAt = data.updatedAt;
    } catch (e) {
      setError('株価取得エラー: ' + String(e));
      setFetchingPrices(false);
      return;
    }

    // 3. Apply results — NEVER overwrite price on failure
    const logEntries: PriceUpdateLogEntry[] = [];
    const failedItems: PriceUpdateSummary['failedItems'] = [];
    let successCount = 0, failedCount = 0;

    setPortfolio(prev => {
      const newItems = prev.items.map(item => {
        if (!item.code.trim()) {
          return { ...item, priceUpdateStatus: 'skipped' as const };
        }

        const result = results.find(r => r.code === item.code);
        if (!result) return item;

        if (result.price != null && isFinite(result.price)) {
          successCount++;
          logEntries.push({
            timestamp: updatedAt,
            code: item.code,
            name: item.name,
            prevPrice: item.price,
            newPrice: result.price,
            status: 'success',
            error: null,
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
          // KEEP existing price on failure
          failedCount++;
          const errMsg = result.error ?? '取得失敗';
          failedItems.push({ code: item.code, name: item.name, error: errMsg });
          logEntries.push({
            timestamp: updatedAt,
            code: item.code,
            name: item.name,
            prevPrice: item.price,
            newPrice: null,
            status: 'failed',
            error: errMsg,
          });
          return {
            ...item,
            // price is NOT changed
            priceError: errMsg,
            priceUpdatedAt: updatedAt,
            priceUpdateStatus: 'failed' as const,
          };
        }
      });

      return { ...prev, items: newItems };
    });

    // Use the counts computed during state update
    // (Re-compute from results for the summary since we can't read state from within setPortfolio)
    const finalSuccess = results.filter(r => r.price != null && isFinite(r.price)).length;
    const finalFailed  = results.filter(r => r.price == null).length;
    const finalSkipped = current.items.filter(i => !i.code.trim()).length;

    const summary: PriceUpdateSummary = {
      updatedAt,
      successCount: finalSuccess,
      failedCount: finalFailed,
      skippedCount: finalSkipped,
      failedItems: results
        .filter(r => r.price == null)
        .map(r => {
          const item = current.items.find(i => i.code === r.code);
          return { code: r.code, name: item?.name ?? '', error: r.error ?? '取得失敗' };
        }),
    };
    setPriceUpdateSummary(summary);

    // 4. Post log
    postPriceLog(logEntries);

    // 5. Auto-save after price update
    setPortfolio(prev => {
      const updated = { ...prev };
      // Trigger a save
      setTimeout(async () => {
        try {
          const r = await fetch('/api/portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
          });
          const saveData = await r.json() as { ok: boolean; lastSaved: string };
          setPortfolio(p => ({ ...p, lastSaved: saveData.lastSaved }));
          setIsDirty(false);
          setSaveStatus(`株価更新 成功${finalSuccess}件${finalFailed > 0 ? ` 失敗${finalFailed}件` : ''}`);
          setTimeout(() => setSaveStatus(null), 5000);
        } catch { /* auto-save failure is non-fatal */ }
      }, 0);
      return prev;
    });

    setFetchingPrices(false);
  }, []);

  // ── Single price fetch ────────────────────────────────────────────────────
  const fetchSinglePrice = useCallback(async (itemId: string, code: string) => {
    if (!code.trim()) return;
    setFetchingPriceItemId(itemId);

    try {
      const r = await fetch('/api/prices/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: [code] }),
      });
      const data = await r.json() as PriceFetchResponse;
      const result = data.results[0];

      setPortfolio(prev => {
        const item = prev.items.find(i => i.id === itemId);
        if (!item) return prev;

        if (result?.price != null && isFinite(result.price)) {
          postPriceLog([{
            timestamp: data.updatedAt,
            code,
            name: item.name,
            prevPrice: item.price,
            newPrice: result.price,
            status: 'success',
            error: null,
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
            timestamp: data.updatedAt,
            code,
            name: item.name,
            prevPrice: item.price,
            newPrice: null,
            status: 'failed',
            error: errMsg,
          }]);
          return {
            ...prev,
            items: prev.items.map(i => i.id === itemId ? {
              ...i,
              // price NOT changed
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

  return {
    portfolio,
    loading,
    saving,
    fetchingPrices,
    fetchingPriceItemId,
    error,
    saveStatus,
    isDirty,
    priceUpdateSummary,
    updateItem,
    updatePriceManually,
    resetPlannedShares,
    updateSummary,
    addItem,
    removeItem,
    save,
    fetchPrices,
    fetchSinglePrice,
    importItems,
  };
}
