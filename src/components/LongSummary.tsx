import type { Portfolio, PortfolioItem, FuturesPosition, HedgeFutures } from '../types';

interface Props {
  portfolio: Portfolio;
  onUpdateSummary: (updates: Partial<Portfolio['summary']>) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeN(n: number | null | undefined): number {
  if (n == null || isNaN(n) || !isFinite(n)) return 0;
  return n;
}

function fmt(n: number, dec = 0): string {
  return n.toLocaleString('ja-JP', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(n: number | null, dec = 1): string {
  if (n == null || !isFinite(n)) return '—';
  return (n * 100).toFixed(dec) + '%';
}

function fmtDiff(n: number): string {
  if (n === 0) return '0';
  return (n > 0 ? '+' : '') + n.toLocaleString('ja-JP');
}

function holding(item: PortfolioItem): number {
  return safeN(item.price) * safeN(item.shares);
}

function plannedHolding(item: PortfolioItem): number {
  const ps = item.plannedShares != null ? item.plannedShares : item.shares;
  return safeN(item.price) * safeN(ps);
}

function calcHedgeAmount(pos: FuturesPosition): number {
  if (pos.price == null || pos.lots == null) return 0;
  return safeN(pos.price) * safeN(pos.lots) * pos.multiplier;
}

// ─── NumInput ─────────────────────────────────────────────────────────────────
// Small numeric input for the futures table
function NumInput({
  value, placeholder, onChange, width = 72,
}: {
  value: number | null;
  placeholder?: string;
  onChange: (v: number | null) => void;
  width?: number;
}) {
  return (
    <input
      type="number"
      className="summary-input"
      style={{ width }}
      value={value ?? ''}
      placeholder={placeholder ?? '—'}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LongSummary({ portfolio, onUpdateSummary }: Props) {
  const { items, summary } = portfolio;
  const hedgeFutures = summary.hedgeFutures;

  const totalAssets = summary.totalAssets ?? null;
  const assetBase = totalAssets != null && totalAssets > 0 ? totalAssets : null;

  // ── Long positions ───────────────────────────────────────────────────────────
  const longItems = items.filter(i => safeN(i.shares) > 0);
  const longTotal = longItems.reduce((acc, i) => acc + holding(i), 0);

  const noTargetCount = longItems.filter(i => i.targetPrice == null).length;

  // ── Futures hedge ─────────────────────────────────────────────────────────────
  const grossHedge  = calcHedgeAmount(hedgeFutures.grossNikkei);
  const nikkeiHedge = calcHedgeAmount(hedgeFutures.nikkei);
  const topixHedge  = calcHedgeAmount(hedgeFutures.topix);
  const totalHedge  = grossHedge + nikkeiHedge + topixHedge;

  // ── Net position ─────────────────────────────────────────────────────────────
  const netBuy = longTotal - totalHedge;
  const longRatio = assetBase != null ? longTotal / assetBase : null;
  const netRatio  = assetBase != null ? netBuy  / assetBase : null;

  // ── Rebalance plan ────────────────────────────────────────────────────────────
  const hasPlan = items.some(i => i.plannedShares != null);
  const plannedLongItems = items.filter(i => safeN(
    i.plannedShares != null ? i.plannedShares : i.shares
  ) > 0);
  const plannedTotal = plannedLongItems.reduce((acc, i) => acc + plannedHolding(i), 0);
  const additionalFunds = hasPlan ? plannedTotal - longTotal : null;
  const plannedNetBuy = hasPlan ? plannedTotal - totalHedge : null;
  const plannedRatio    = assetBase != null && hasPlan ? plannedTotal / assetBase : null;
  const plannedNetRatio = assetBase != null && hasPlan ? (plannedTotal - totalHedge) / assetBase : null;

  // ── Top 5 ──────────────────────────────────────────────────────────────────
  const currentRanked = [...longItems].sort((a, b) => holding(b) - holding(a)).slice(0, 5);

  // ── Futures update helper ─────────────────────────────────────────────────
  function setFutures<K extends keyof FuturesPosition>(
    key: keyof HedgeFutures,
    field: K,
    value: FuturesPosition[K],
  ) {
    onUpdateSummary({
      hedgeFutures: {
        ...hedgeFutures,
        [key]: { ...hedgeFutures[key], [field]: value },
      },
    });
  }

  const FUTURES_ROWS: { key: keyof HedgeFutures; label: string }[] = [
    { key: 'grossNikkei', label: 'グロ先' },
    { key: 'nikkei',      label: '日経先物' },
    { key: 'topix',       label: 'TOPIX先物' },
  ];

  const hedgeAmounts = {
    grossNikkei: grossHedge,
    nikkei:      nikkeiHedge,
    topix:       topixHedge,
  };

  return (
    <div className="summary-section">
      <h2 className="summary-title">サマリー</h2>

      {/* ── 総資産額 ────────────────────────────────────────────── */}
      <div className="total-assets-bar">
        <span className="total-assets-label">総資産額</span>
        <input
          type="number"
          className="total-assets-input"
          value={totalAssets ?? ''}
          placeholder="例: 700000000"
          onChange={e => onUpdateSummary({
            totalAssets: e.target.value === '' ? null : Number(e.target.value),
          })}
        />
        {totalAssets != null && totalAssets > 0 && (
          <span className="total-assets-display">¥{fmt(totalAssets)}</span>
        )}
        {(totalAssets == null || totalAssets === 0) && (
          <span className="total-assets-hint">※ 入力すると資産比率を計算します</span>
        )}
      </div>

      <div className="summary-grid">

        {/* ── A. ポジション ──────────────────────────────────────── */}
        <div className="summary-group">
          <h3>ポジション</h3>
          <table className="summary-table">
            <tbody>
              {assetBase != null && (
                <tr>
                  <td>総資産額</td>
                  <td className="num summary-highlight-cell">{fmt(assetBase)}</td>
                </tr>
              )}
              <tr>
                <td>買いポジ</td>
                <td className="num">{fmt(longTotal)}</td>
              </tr>
              <tr>
                <td>買いポジ比率</td>
                <td className="num">{assetBase != null ? fmtPct(longRatio) : '—'}</td>
              </tr>
              <tr>
                <td>先物ヘッジ</td>
                <td className="num">{totalHedge > 0 ? fmt(totalHedge) : '—'}</td>
              </tr>
              <tr className="summary-highlight">
                <td>ネット買いポジ</td>
                <td className="num">{fmt(netBuy)}</td>
              </tr>
              <tr>
                <td>ネット比率</td>
                <td className="num">{assetBase != null ? fmtPct(netRatio) : '—'}</td>
              </tr>
              <tr>
                <td>銘柄数</td>
                <td className="num">{longItems.length}</td>
              </tr>
              {noTargetCount > 0 && (
                <tr>
                  <td>目標未設定</td>
                  <td className="num ls-warn">{noTargetCount} 銘柄</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── B. リバランス計画 ────────────────────────────────────── */}
        <div className="summary-group">
          <h3>リバランス計画</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>予定後買いポジ</td>
                <td className="num">{hasPlan ? fmt(plannedTotal) : '—'}</td>
              </tr>
              <tr>
                <td>予定後買いポジ比率</td>
                <td className="num">{assetBase != null ? fmtPct(plannedRatio) : '—'}</td>
              </tr>
              <tr>
                <td>追加必要資金</td>
                <td className={`num ${additionalFunds == null ? '' : additionalFunds > 0 ? 'ls-warn' : 'ls-good'}`}>
                  {additionalFunds != null
                    ? <span title={additionalFunds > 0 ? '追加買い越し' : '売り越し'}>
                        {fmtDiff(additionalFunds)}
                      </span>
                    : '予定株数未入力'}
                </td>
              </tr>
              <tr>
                <td>予定後ネット買いポジ</td>
                <td className="num">{plannedNetBuy != null ? fmt(plannedNetBuy) : '—'}</td>
              </tr>
              <tr>
                <td>予定後ネット比率</td>
                <td className="num">{assetBase != null ? fmtPct(plannedNetRatio) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── C. 先物ヘッジ ──────────────────────────────────────── */}
        <div className="summary-group futures-group">
          <h3>先物ヘッジ</h3>
          <table className="summary-table futures-table">
            <thead>
              <tr>
                <th>種類</th>
                <th className="num">価格</th>
                <th className="num">枚数</th>
                <th className="num" style={{ fontSize: 10, color: '#94a3b8' }}>乗数</th>
                <th className="num">ヘッジ総額</th>
              </tr>
            </thead>
            <tbody>
              {FUTURES_ROWS.map(({ key, label }) => {
                const pos = hedgeFutures[key];
                const amt = hedgeAmounts[key];
                return (
                  <tr key={key}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{label}</td>
                    <td className="num" style={{ padding: '1px 2px' }}>
                      <NumInput
                        value={pos.price}
                        placeholder="価格"
                        onChange={v => setFutures(key, 'price', v)}
                        width={70}
                      />
                    </td>
                    <td className="num" style={{ padding: '1px 2px' }}>
                      <NumInput
                        value={pos.lots}
                        placeholder="枚数"
                        onChange={v => setFutures(key, 'lots', v)}
                        width={44}
                      />
                    </td>
                    <td className="num" style={{ padding: '1px 2px' }}>
                      <NumInput
                        value={pos.multiplier}
                        placeholder="乗数"
                        onChange={v => setFutures(key, 'multiplier', v ?? 1)}
                        width={46}
                      />
                    </td>
                    <td className="num" style={{ fontWeight: amt > 0 ? 600 : undefined }}>
                      {amt > 0 ? fmt(amt) : '—'}
                    </td>
                  </tr>
                );
              })}
              <tr className="summary-highlight">
                <td>合計</td>
                <td></td>
                <td></td>
                <td></td>
                <td className="num">{totalHedge > 0 ? fmt(totalHedge) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── D. 現在 上位保有 ──────────────────────────────────── */}
        {currentRanked.length > 0 && (
          <div className="summary-group">
            <h3>現在 上位保有</h3>
            <table className="summary-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>銘柄</th>
                  <th className="num">{assetBase != null ? '割合' : 'PF比率'}</th>
                </tr>
              </thead>
              <tbody>
                {currentRanked.map((item, i) => (
                  <tr key={item.id}>
                    <td style={{ color: '#64748b', fontSize: 10 }}>{i + 1}</td>
                    <td>{item.name || item.code}</td>
                    <td className="num">
                      {assetBase != null
                        ? fmtPct(holding(item) / assetBase)
                        : longTotal > 0 ? fmtPct(holding(item) / longTotal) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}
