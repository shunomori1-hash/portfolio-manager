import type { Portfolio, PortfolioItem } from '../types';

interface Props {
  portfolio: Portfolio;
  onUpdateSummary: (updates: Partial<Portfolio['summary']>) => void;
}

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
  const s = n > 0 ? '+' : '';
  return s + n.toLocaleString('ja-JP');
}

function holding(item: PortfolioItem): number {
  return safeN(item.price) * safeN(item.shares);
}

// Use plannedShares if set; fall back to current shares for "no change" assumption
function plannedHolding(item: PortfolioItem): number {
  const ps = item.plannedShares != null ? item.plannedShares : item.shares;
  return safeN(item.price) * safeN(ps);
}

export function LongSummary({ portfolio, onUpdateSummary }: Props) {
  const { items, summary } = portfolio;

  const longItems = items.filter(i => safeN(i.shares) > 0);
  const sellItems = items.filter(i => safeN(i.shares) < 0);

  const longTotal = longItems.reduce((acc, i) => acc + holding(i), 0);
  const sellTotal = Math.abs(sellItems.reduce((acc, i) => acc + holding(i), 0));

  const nikkei = safeN(summary.nikkeiFutures);
  const topix  = safeN(summary.topixFutures);
  const netBuy = longTotal - sellTotal + nikkei + topix;
  const netBuyRatio = longTotal > 0 ? netBuy / longTotal : null;

  // 目標ベース
  const expectedTotal = longItems.reduce((acc, i) => {
    if (i.targetPrice == null || i.shares == null) return acc;
    return acc + i.targetPrice * safeN(i.shares);
  }, 0);
  const expectedUpside = expectedTotal > 0 ? expectedTotal - longTotal : 0;
  const weightedUpside = longTotal > 0 && expectedUpside > 0 ? expectedUpside / longTotal : null;

  // 配当
  const dividendTotal = longItems.reduce((acc, i) => {
    if (i.dividend == null || i.shares == null) return acc;
    return acc + i.dividend * safeN(i.shares);
  }, 0);
  const wDivYield = longTotal > 0 && dividendTotal > 0 ? dividendTotal / longTotal : null;

  // 目標未設定
  const noTargetCount = longItems.filter(i => i.targetPrice == null).length;

  // ─── リバランス計画 ──────────────────────────────────────────────────────────
  const hasPlan = items.some(i => i.plannedShares != null);

  // For planned total: use plannedShares if set, else current shares (no change assumed)
  const plannedLongItems = items.filter(i => {
    const ps = i.plannedShares != null ? i.plannedShares : i.shares;
    return safeN(ps) > 0;
  });
  const plannedTotal = plannedLongItems.reduce((acc, i) => acc + plannedHolding(i), 0);
  const additionalFunds = hasPlan ? plannedTotal - longTotal : null;

  // 予定後上位5銘柄
  const plannedRanked = [...items]
    .filter(i => {
      const ps = i.plannedShares != null ? i.plannedShares : i.shares;
      return safeN(ps) > 0 && i.price != null;
    })
    .sort((a, b) => plannedHolding(b) - plannedHolding(a))
    .slice(0, 5);

  // 現在上位5銘柄 (for summary)
  const currentRanked = [...longItems]
    .sort((a, b) => holding(b) - holding(a))
    .slice(0, 5);

  return (
    <div className="summary-section">
      <h2 className="summary-title">サマリー</h2>
      <div className="summary-grid">

        {/* ロングPF概要 */}
        <div className="summary-group">
          <h3>ロングPF</h3>
          <table className="summary-table">
            <tbody>
              <tr className="summary-highlight">
                <td>保有金額合計</td>
                <td className="num">{fmt(longTotal)}</td>
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
              <tr>
                <td>ネット買いポジ</td>
                <td className="num">{fmt(netBuy)}</td>
              </tr>
              <tr>
                <td>ネット比率</td>
                <td className="num">{fmtPct(netBuyRatio)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* リバランス計画 */}
        <div className="summary-group">
          <h3>リバランス計画</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>現在ロング合計</td>
                <td className="num">{fmt(longTotal)}</td>
              </tr>
              <tr>
                <td>予定後ロング合計</td>
                <td className="num">{hasPlan ? fmt(plannedTotal) : '—'}</td>
              </tr>
              <tr>
                <td>追加必要資金</td>
                <td className={`num ${additionalFunds == null ? '' : additionalFunds > 0 ? 'ls-warn' : additionalFunds < 0 ? 'ls-good' : ''}`}>
                  {additionalFunds != null
                    ? <span title={additionalFunds > 0 ? '追加買い越し' : additionalFunds < 0 ? '売り越し（資金回収）' : '変化なし'}>
                        {fmtDiff(additionalFunds)}
                      </span>
                    : '予定株数未入力'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 目標ベース */}
        <div className="summary-group">
          <h3>目標ベース</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>期待評価額</td>
                <td className="num">{expectedTotal > 0 ? fmt(expectedTotal) : '—'}</td>
              </tr>
              <tr>
                <td>期待上値額</td>
                <td className="num">{expectedUpside > 0 ? fmt(expectedUpside) : '—'}</td>
              </tr>
              <tr>
                <td>加重平均上値余地</td>
                <td className={`num ${weightedUpside != null && weightedUpside >= 0.2 ? 'ls-good' : ''}`}>
                  {fmtPct(weightedUpside)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 配当 */}
        <div className="summary-group">
          <h3>配当</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>年間配当金</td>
                <td className="num">{dividendTotal > 0 ? fmt(dividendTotal) : '—'}</td>
              </tr>
              <tr>
                <td>加重平均利回り</td>
                <td className="num">{fmtPct(wDivYield)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 先物 */}
        <div className="summary-group">
          <h3>先物</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>グロ先合計</td>
                <td className="num">{fmt(Math.abs(nikkei) + Math.abs(topix))}</td>
              </tr>
              <tr>
                <td>日経先物</td>
                <td className="num">
                  <input type="number" className="summary-input"
                    value={summary.nikkeiFutures ?? ''}
                    placeholder="—"
                    onChange={e => onUpdateSummary({ nikkeiFutures: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </td>
              </tr>
              <tr>
                <td>TOPIX先物</td>
                <td className="num">
                  <input type="number" className="summary-input"
                    value={summary.topixFutures ?? ''}
                    placeholder="—"
                    onChange={e => onUpdateSummary({ topixFutures: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 現在の上位保有 */}
        {currentRanked.length > 0 && (
          <div className="summary-group">
            <h3>現在 上位保有</h3>
            <table className="summary-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>銘柄</th>
                  <th className="num">比率</th>
                </tr>
              </thead>
              <tbody>
                {currentRanked.map((item, i) => (
                  <tr key={item.id}>
                    <td style={{ color: '#64748b', fontSize: 10 }}>{i + 1}</td>
                    <td>{item.name || item.code}</td>
                    <td className="num">
                      {longTotal > 0 ? fmtPct(holding(item) / longTotal) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 予定後の上位保有 */}
        {hasPlan && plannedRanked.length > 0 && (
          <div className="summary-group">
            <h3>予定後 上位保有</h3>
            <table className="summary-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>銘柄</th>
                  <th className="num">予定比率</th>
                </tr>
              </thead>
              <tbody>
                {plannedRanked.map((item, i) => (
                  <tr key={item.id}>
                    <td style={{ color: '#64748b', fontSize: 10 }}>{i + 1}</td>
                    <td>{item.name || item.code}</td>
                    <td className="num">
                      {plannedTotal > 0 ? fmtPct(plannedHolding(item) / plannedTotal) : '—'}
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
