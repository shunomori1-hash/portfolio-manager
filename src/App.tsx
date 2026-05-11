import { useState, useMemo, useEffect } from 'react';
import { usePortfolio } from './hooks/usePortfolio';
import { PortfolioTable } from './components/PortfolioTable';
import { LongSummary } from './components/LongSummary';
import { FilterBar } from './components/FilterBar';
import { ColumnSettingsModal } from './components/ColumnSettingsModal';
import { AddItemModal } from './components/AddItemModal';
import { CsvImportModal } from './components/CsvImportModal';
import { PriceLogModal } from './components/PriceLogModal';
import type { PortfolioId } from './types';
import { PORTFOLIO_LABELS } from './types';
import {
  COL_PRESETS,
  DEFAULT_FILTER,
  DEFAULT_SORT,
  sortItems,
  filterItems,
  isFilterActive,
  loadColSettings,
  saveColSettings,
  type ColKey,
  type SortKey,
  type SortState,
  type FilterState,
} from './utils/tableState';

const PORTFOLIO_IDS: PortfolioId[] = ['personal', 'company'];

export default function App() {
  // ── Portfolio selection ───────────────────────────────────────────────────
  const [activePortfolioId, setActivePortfolioId] = useState<PortfolioId>('personal');

  const {
    portfolio, loading, saving, fetchingPrices, fetchingPriceItemId,
    fetchingTechnicals, technicalUpdateSummary,
    error, saveStatus, isDirty, priceUpdateSummary,
    updateItem, updatePriceManually, resetPlannedShares, updateSummary,
    addItem, removeItem, save, fetchPrices, fetchSinglePrice,
    fetchFuturesPrices, fetchingFutures, fetchTechnicals, importItems,
  } = usePortfolio(activePortfolioId);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [density, setDensity] = useState<'compact' | 'standard'>('compact');
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showColSettings, setShowColSettings] = useState(false);
  const [showPriceLog, setShowPriceLog] = useState(false);
  const [showFailedList, setShowFailedList] = useState(false);
  const [showTechDetail, setShowTechDetail] = useState(false);
  const [techResultVisible, setTechResultVisible] = useState(false);

  // ── Table state ───────────────────────────────────────────────────────────
  const [sortState, setSortState] = useState<SortState>(DEFAULT_SORT);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    () => loadColSettings('personal') ?? new Set(COL_PRESETS.investment)
  );

  // ── Portfolio switch with unsaved-changes guard ───────────────────────────
  const handleSwitchPortfolio = (newId: PortfolioId) => {
    if (newId === activePortfolioId) return;
    if (isDirty) {
      const msg = '未保存の変更があります。保存せずにポートフォリオを切り替えますか？';
      if (!confirm(msg)) return;
    }
    setActivePortfolioId(newId);
    // Reset table state on switch so stale sort/filter doesn't confuse the user
    setSortState(DEFAULT_SORT);
    setFilter(DEFAULT_FILTER);
    setShowFailedList(false);
    // Restore column settings saved for the new portfolio (fall back to investment preset)
    setVisibleCols(loadColSettings(newId) ?? new Set(COL_PRESETS.investment));
  };

  const handleSort = (key: SortKey) => {
    setSortState(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'holding' || key === 'ratio' || key === 'upside' || key === 'dividendYield' ? 'desc' : 'asc' }
    );
  };

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

  // Show tech result bar whenever a new summary arrives
  useEffect(() => {
    if (technicalUpdateSummary) {
      setTechResultVisible(true);
      setShowTechDetail(false);
    }
  }, [technicalUpdateSummary]);

  // ── Loading / error ──────────────────────────────────────────────────────
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

  const priceStatusText = (() => {
    if (fetchingPrices) return '株価取得中...';
    if (!priceUpdateSummary) {
      const dates = portfolio.items.map(i => i.priceUpdatedAt).filter(Boolean).sort();
      if (!dates.length) return null;
      return `株価: ${new Date(dates[dates.length - 1]!).toLocaleString('ja-JP')}`;
    }
    const { updatedAt, successCount, failedCount, fiscalMonth } = priceUpdateSummary;
    const ts = new Date(updatedAt).toLocaleString('ja-JP');
    let text = `株価更新: ${ts} | ✓${successCount}件${failedCount > 0 ? ` | ✗${failedCount}件` : ''}`;
    if (fiscalMonth && (fiscalMonth.successCount > 0 || fiscalMonth.failedCount > 0)) {
      text += ` | 決算月補完: ✓${fiscalMonth.successCount}件`;
      if (fiscalMonth.failedCount > 0) text += ` ✗${fiscalMonth.failedCount}件`;
    }
    const cn = priceUpdateSummary.companyName;
    if (cn && (cn.filledCount > 0 || cn.correctionCount > 0 || cn.unregisteredCount > 0)) {
      text += ` | 銘柄名補完: ✓${cn.filledCount}件`;
      if (cn.correctionCount > 0)   text += ` 補正${cn.correctionCount}件`;
      if (cn.unregisteredCount > 0) text += ` 未登録${cn.unregisteredCount}件`;
    }
    return text;
  })();

  const hasFailures = (priceUpdateSummary?.failedCount ?? 0) > 0;

  return (
    <div className={`app${density === 'standard' ? ' density-standard' : ''}`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-left">
          <h1>ポートフォリオ管理</h1>

          {/* ── Portfolio switcher ──────────────────────────────────── */}
          <div className="portfolio-switcher">
            {PORTFOLIO_IDS.map(id => (
              <button
                key={id}
                className={`portfolio-tab${activePortfolioId === id ? ' active' : ''}`}
                onClick={() => handleSwitchPortfolio(id)}
              >
                {PORTFOLIO_LABELS[id]}
              </button>
            ))}
          </div>

          {priceStatusText && (
            <span
              className={`price-updated ${hasFailures ? 'price-status-warn' : ''}`}
              style={{ cursor: hasFailures ? 'pointer' : 'default' }}
              onClick={() => hasFailures && setShowFailedList(v => !v)}
              title={hasFailures ? 'クリックで失敗銘柄を表示' : undefined}
            >
              {priceStatusText}
              {hasFailures && <span style={{ marginLeft: 4 }}>▼</span>}
            </span>
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
          <button className="btn btn-secondary"
            onClick={() => setShowPriceLog(true)}
            title="株価更新ログを表示">
            更新ログ
          </button>
          <button className="btn btn-import"
            onClick={() => setShowCsvImport(true)}>
            CSVインポート
          </button>
          <button className="btn btn-secondary"
            onClick={() => setShowAddItem(true)}>
            ＋ 銘柄追加
          </button>
          <button className="btn btn-secondary"
            title="全銘柄の予定株数を現在株数にリセット"
            onClick={() => {
              if (confirm('全銘柄の予定株数を現在株数にリセットしますか？')) {
                resetPlannedShares();
              }
            }}>
            予定リセット
          </button>
          <button className="btn btn-primary"
            onClick={() => fetchPrices(portfolio)}
            disabled={fetchingPrices || fetchingTechnicals}>
            {fetchingPrices ? '取得中...' : '株価一括更新'}
          </button>
          <button className="btn btn-tech"
            onClick={() => fetchTechnicals()}
            disabled={fetchingTechnicals || fetchingPrices}
            title="選択中PFの銘柄について日足データを取得しテク列を自動判定します">
            {fetchingTechnicals ? 'テク判定中...' : 'テク更新'}
          </button>
          <button className="btn btn-save"
            onClick={() => save(portfolio)}
            disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </header>

      {/* ── Failed items list (collapsible) ─────────────────────────────── */}
      {showFailedList && priceUpdateSummary && priceUpdateSummary.failedItems.length > 0 && (
        <div className="failed-price-bar">
          <span className="failed-price-title">取得失敗銘柄:</span>
          {priceUpdateSummary.failedItems.map((f, i) => (
            <span key={i} className="failed-price-item" title={f.error}>
              {f.code} {f.name}{f.error ? `：${f.error}` : ''}
            </span>
          ))}
          <button className="btn-filter-clear" style={{ marginLeft: 8 }}
            onClick={() => setShowFailedList(false)}>閉じる</button>
        </div>
      )}

      {/* ── Technical update result bar ─────────────────────────────────── */}
      {techResultVisible && technicalUpdateSummary && (
        <div className="tech-result-bar">
          <span className="tech-result-title">テク更新:</span>
          <span>成功 {technicalUpdateSummary.successCount + technicalUpdateSummary.cachedCount}件</span>
          {technicalUpdateSummary.boostedCount > 0 && (
            <span className="tech-result-boost"> 高値ブレイク {technicalUpdateSummary.boostedCount}件</span>
          )}
          {technicalUpdateSummary.insufficientDataCount > 0 && (
            <span className="tech-result-warn"> データ不足 {technicalUpdateSummary.insufficientDataCount}件</span>
          )}
          {technicalUpdateSummary.failedCount > 0 && (
            <span className="tech-result-error"> 失敗 {technicalUpdateSummary.failedCount}件</span>
          )}
          {(technicalUpdateSummary.failedCount > 0 || technicalUpdateSummary.insufficientDataCount > 0) && (
            <button className="btn-filter-clear" style={{ marginLeft: 8 }}
              onClick={() => setShowTechDetail(v => !v)}>
              {showTechDetail ? '閉じる' : '詳細'}
            </button>
          )}
          <button className="btn-filter-clear" style={{ marginLeft: 4 }}
            onClick={() => { setTechResultVisible(false); setShowTechDetail(false); }}>×</button>
        </div>
      )}
      {showTechDetail && technicalUpdateSummary && (
        <div className="tech-detail-bar">
          {technicalUpdateSummary.results
            .filter(r => r.status === 'failed' || r.status === 'insufficient_data')
            .map((r, i) => (
              <span key={i} className="failed-price-item" title={r.reason}>
                {r.code} {r.name}:{r.status === 'insufficient_data' ? 'データ不足' : '失敗'}
              </span>
            ))}
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <FilterBar
        filter={filter}
        onChange={u => setFilter(prev => ({ ...prev, ...u }))}
        onClear={() => setFilter(DEFAULT_FILTER)}
        active={filterActive}
        totalCount={portfolio.items.length}
        filteredCount={displayItems.length}
      />

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="app-main">
        <PortfolioTable
          items={displayItems}
          onUpdate={updateItem}
          onUpdatePrice={updatePriceManually}
          onRefreshPrice={fetchSinglePrice}
          onRemove={removeItem}
          visibleCols={visibleCols}
          sortState={sortState}
          onSort={handleSort}
          fetchingPriceItemId={fetchingPriceItemId}
          totalAssets={portfolio.summary.totalAssets ?? null}
        />
        <LongSummary
          portfolio={portfolio}
          onUpdateSummary={updateSummary}
          onFetchFuturesPrices={fetchFuturesPrices}
          fetchingFutures={fetchingFutures}
        />
      </main>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showAddItem && (
        <AddItemModal onAdd={addItem} onClose={() => setShowAddItem(false)} />
      )}
      {showColSettings && (
        <ColumnSettingsModal
          visible={visibleCols}
          onApply={cols => {
            setVisibleCols(cols);
            saveColSettings(activePortfolioId, cols);
          }}
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
      {showPriceLog && (
        <PriceLogModal onClose={() => setShowPriceLog(false)} />
      )}
    </div>
  );
}
