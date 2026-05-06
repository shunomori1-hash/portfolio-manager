import { useState, useMemo } from 'react';
import { usePortfolio } from './hooks/usePortfolio';
import { PortfolioTable } from './components/PortfolioTable';
import { LongSummary } from './components/LongSummary';
import { FilterBar } from './components/FilterBar';
import { ColumnSettingsModal } from './components/ColumnSettingsModal';
import { AddItemModal } from './components/AddItemModal';
import { CsvImportModal } from './components/CsvImportModal';
import {
  COL_PRESETS,
  DEFAULT_FILTER,
  DEFAULT_SORT,
  sortItems,
  filterItems,
  isFilterActive,
  type ColKey,
  type SortKey,
  type SortState,
  type FilterState,
} from './utils/tableState';

export default function App() {
  const {
    portfolio, loading, saving, fetchingPrices,
    error, saveStatus, isDirty,
    updateItem, updateSummary, addItem, removeItem,
    save, fetchPrices, importItems,
  } = usePortfolio();

  // ── UI state ─────────────────────────────────────────────────────────────
  const [density, setDensity] = useState<'compact' | 'standard'>('compact');
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showColSettings, setShowColSettings] = useState(false);

  // ── Table state ───────────────────────────────────────────────────────────
  const [sortState, setSortState] = useState<SortState>(DEFAULT_SORT);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(new Set(COL_PRESETS.investment));

  const handleSort = (key: SortKey) => {
    setSortState(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'holding' || key === 'ratio' || key === 'upside' || key === 'dividendYield' ? 'desc' : 'asc' }
    );
  };

  const handleFilterChange = (updates: Partial<FilterState>) =>
    setFilter(prev => ({ ...prev, ...updates }));

  const handleFilterClear = () => setFilter(DEFAULT_FILTER);

  // ── Compute visible items ─────────────────────────────────────────────────
  const totalBuy = useMemo(() =>
    portfolio.items.reduce((acc, item) => {
      if (item.price == null || item.shares == null) return acc;
      const h = item.price * item.shares;
      return acc + (h > 0 ? h : 0);
    }, 0),
    [portfolio.items]
  );

  const displayItems = useMemo(() => {
    const filtered = filterItems(portfolio.items, filter);
    return sortItems(filtered, sortState, totalBuy);
  }, [portfolio.items, filter, sortState, totalBuy]);

  const filterActive = isFilterActive(filter);

  // ── Loading / error screens ──────────────────────────────────────────────
  if (loading) return <div className="loading">データを読み込み中...</div>;
  if (error && !portfolio.items.length) {
    return (
      <div className="error-screen">
        <p>エラー: {error}</p>
        <p>APIサーバーが起動しているか確認してください（npm run dev:all）</p>
      </div>
    );
  }

  const lastSaved = portfolio.lastSaved
    ? new Date(portfolio.lastSaved).toLocaleString('ja-JP')
    : '未保存';

  const priceUpdatedAt = (() => {
    const dates = portfolio.items.map(i => i.priceUpdatedAt).filter(Boolean).sort();
    if (!dates.length) return null;
    return new Date(dates[dates.length - 1]!).toLocaleString('ja-JP');
  })();

  return (
    <div className={`app${density === 'standard' ? ' density-standard' : ''}`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-left">
          <h1>ポートフォリオ管理</h1>
          {priceUpdatedAt && (
            <span className="price-updated">株価: {priceUpdatedAt}</span>
          )}
        </div>
        <div className="header-right">
          {error && <span className="header-error">{error}</span>}
          {saveStatus && <span className="save-status">{saveStatus}</span>}
          {isDirty && !saveStatus && (
            <span className="unsaved-indicator">未保存の変更あり</span>
          )}
          <span className="last-saved">保存: {lastSaved}</span>

          <button className="btn btn-density"
            onClick={() => setDensity(d => d === 'compact' ? 'standard' : 'compact')}>
            {density === 'compact' ? '標準' : 'コンパクト'}
          </button>
          <button className="btn btn-secondary"
            onClick={() => setShowColSettings(true)}>
            列設定
          </button>
          <button className="btn btn-import"
            onClick={() => setShowCsvImport(true)}>
            CSVインポート
          </button>
          <button className="btn btn-secondary"
            onClick={() => setShowAddItem(true)}>
            ＋ 銘柄追加
          </button>
          <button className="btn btn-primary"
            onClick={() => fetchPrices(portfolio)}
            disabled={fetchingPrices}>
            {fetchingPrices ? '取得中...' : '株価更新'}
          </button>
          <button className="btn btn-save"
            onClick={() => save(portfolio)}
            disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </header>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <FilterBar
        filter={filter}
        onChange={handleFilterChange}
        onClear={handleFilterClear}
        active={filterActive}
        totalCount={portfolio.items.length}
        filteredCount={displayItems.length}
      />

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="app-main">
        <PortfolioTable
          items={displayItems}
          onUpdate={updateItem}
          onRemove={removeItem}
          visibleCols={visibleCols}
          sortState={sortState}
          onSort={handleSort}
        />
        <LongSummary portfolio={portfolio} onUpdateSummary={updateSummary} />
      </main>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showAddItem && (
        <AddItemModal
          onAdd={initial => addItem(initial)}
          onClose={() => setShowAddItem(false)}
        />
      )}
      {showColSettings && (
        <ColumnSettingsModal
          visible={visibleCols}
          onApply={setVisibleCols}
          onClose={() => setShowColSettings(false)}
        />
      )}
      {showCsvImport && (
        <CsvImportModal
          existingItems={portfolio.items}
          onImport={importItems}
          onClose={() => setShowCsvImport(false)}
        />
      )}
    </div>
  );
}
