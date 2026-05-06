import { useState, useCallback, useEffect } from 'react';
import type { Portfolio, PortfolioItem, PriceFetchResponse } from '../types';

const DEFAULT_PORTFOLIO: Portfolio = {
  items: [],
  summary: { nikkeiFutures: null, topixFutures: null },
  lastSaved: null,
};

export function usePortfolio() {
  const [portfolio, setPortfolio] = useState<Portfolio>(DEFAULT_PORTFOLIO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then((data: Portfolio) => {
        setPortfolio(data);
        setLoading(false);
      })
      .catch(e => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<PortfolioItem>) => {
    setPortfolio(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, ...updates } : item),
    }));
  }, []);

  const updateSummary = useCallback((updates: Partial<Portfolio['summary']>) => {
    setPortfolio(prev => ({
      ...prev,
      summary: { ...prev.summary, ...updates },
    }));
  }, []);

  const addItem = useCallback(() => {
    const newItem: PortfolioItem = {
      id: crypto.randomUUID(),
      code: '',
      name: '',
      price: null,
      shares: null,
      plannedDelta: null,
      settlementMonth: '',
      tech: '',
      topix: '',
      borderPrice: null,
      targetPrice: null,
      targetPeriod: '',
      fx: '',
      inflation: '',
      ir: '',
      per: null,
      management: '',
      competitiveness: '',
      governance: '',
      netCash: null,
      marchDividend: null,
      dividend: null,
      benefit: null,
      memo: '',
      tag: '',
      priceUpdatedAt: null,
      priceError: null,
    };
    setPortfolio(prev => ({ ...prev, items: [...prev.items, newItem] }));
  }, []);

  const removeItem = useCallback((id: string) => {
    setPortfolio(prev => ({ ...prev, items: prev.items.filter(item => item.id !== id) }));
  }, []);

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
      setSaveStatus('保存しました');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      setSaveStatus('保存失敗: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const importItems = useCallback(async (items: PortfolioItem[]) => {
    setSaving(true);
    setSaveStatus(null);
    // Read current portfolio state via functional updater to avoid stale closure,
    // then immediately POST the new version.
    let newPortfolio: Portfolio | null = null;
    setPortfolio(prev => {
      newPortfolio = { ...prev, items };
      return newPortfolio;
    });
    // Wait a tick for the state update to flush, then save
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
      setSaveStatus('インポート完了');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      setSaving(false);
      throw new Error('JSON保存に失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    }
    setSaving(false);
  }, []);

  const fetchPrices = useCallback(async (current: Portfolio) => {
    const codes = current.items.map(i => i.code).filter(Boolean);
    if (!codes.length) return;

    setFetchingPrices(true);
    try {
      const r = await fetch('/api/prices/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      const data = await r.json() as PriceFetchResponse;

      setPortfolio(prev => ({
        ...prev,
        items: prev.items.map(item => {
          const result = data.results.find(r => r.code === item.code);
          if (!result) return item;
          if (result.price != null) {
            return { ...item, price: result.price, priceUpdatedAt: data.updatedAt, priceError: null };
          }
          return { ...item, priceError: result.error, priceUpdatedAt: data.updatedAt };
        }),
      }));
    } catch (e) {
      setError('株価取得エラー: ' + String(e));
    } finally {
      setFetchingPrices(false);
    }
  }, []);

  return {
    portfolio,
    loading,
    saving,
    fetchingPrices,
    error,
    saveStatus,
    updateItem,
    updateSummary,
    addItem,
    removeItem,
    save,
    fetchPrices,
    importItems,
  };
}
