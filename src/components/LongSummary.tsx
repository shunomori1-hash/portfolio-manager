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

function holding(item: PortfolioItem): number {
  return safeN(item.price) * safeN(item.shares);
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

  // 上位5銘柄
  const ranked = [...longItems]
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
                  <input
                    type="number"
                    className="summary-input"
                    value={summary.nikkeiFutures ?? ''}
                    placeholder="—"
                    onChange={e => onUpdateSummary({ nikkeiFutures: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </td>
              </tr>
              <tr>
                <td>TOPIX先物</td>
                <td className="num">
                  <input
                    type="number"
                    className="summary-input"
                    value={summary.topixFutures ?? ''}
                    placeholder="—"
                    onChange={e => onUpdateSummary({ topixFutures: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 上位保有 */}
        {ranked.length > 0 && (
          <div className="summary-group">
            <h3>上位保有</h3>
            <table className="summary-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>銘柄</th>
                  <th className="num">比率</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((item, i) => (
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
      </div>
    </div>
  );
}
