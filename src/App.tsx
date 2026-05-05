import { usePortfolio } from './hooks/usePortfolio';
import { PortfolioTable } from './components/PortfolioTable';
import { Summary } from './components/Summary';

export default function App() {
  const {
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
  } = usePortfolio();

  if (loading) {
    return <div className="loading">データを読み込み中...</div>;
  }

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
    const dates = portfolio.items
      .map(i => i.priceUpdatedAt)
      .filter(Boolean)
      .sort();
    if (!dates.length) return null;
    return new Date(dates[dates.length - 1]!).toLocaleString('ja-JP');
  })();

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>ポートフォリオ管理</h1>
          {priceUpdatedAt && (
            <span className="price-updated">株価取得: {priceUpdatedAt}</span>
          )}
        </div>
        <div className="header-right">
          {error && <span className="header-error">{error}</span>}
          {saveStatus && <span className="save-status">{saveStatus}</span>}
          <span className="last-saved">保存: {lastSaved}</span>
          <button className="btn btn-secondary" onClick={addItem}>
            ＋ 行追加
          </button>
          <button
            className="btn btn-primary"
            onClick={() => fetchPrices(portfolio)}
            disabled={fetchingPrices}
          >
            {fetchingPrices ? '取得中...' : '株価一括更新'}
          </button>
          <button
            className="btn btn-save"
            onClick={() => save(portfolio)}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </header>

      <main className="app-main">
        <PortfolioTable
          items={portfolio.items}
          onUpdate={updateItem}
          onRemove={removeItem}
        />
        <Summary portfolio={portfolio} onUpdateSummary={updateSummary} />
      </main>
    </div>
  );
}
