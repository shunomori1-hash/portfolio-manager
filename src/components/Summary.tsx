import type { Portfolio, PortfolioItem, TagValue } from '../types';

interface Props {
  portfolio: Portfolio;
  onUpdateSummary: (updates: Partial<Portfolio['summary']>) => void;
}

function calcHolding(item: PortfolioItem) {
  if (item.price == null || item.shares == null) return null;
  return item.price * item.shares;
}

function calcDividendAmount(item: PortfolioItem) {
  if (item.dividend == null || item.shares == null) return null;
  return item.dividend * item.shares;
}

function fmt(n: number | null, decimals = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number | null): string {
  if (n == null) return '—';
  return (n * 100).toFixed(1) + '%';
}

const TAG_LABELS: { value: TagValue; label: string }[] = [
  { value: '◎', label: '◎' },
  { value: '○', label: '○' },
  { value: '△', label: '△' },
  { value: '×', label: '×' },
  { value: '', label: '未設定' },
];

export function Summary({ portfolio, onUpdateSummary }: Props) {
  const { items, summary } = portfolio;

  const buyPositions = items.filter(i => (i.shares ?? 0) > 0);
  const sellPositions = items.filter(i => (i.shares ?? 0) < 0);

  const buyTotal = buyPositions.reduce((acc, i) => {
    const h = calcHolding(i);
    return acc + (h ?? 0);
  }, 0);

  const sellTotal = Math.abs(sellPositions.reduce((acc, i) => {
    const h = calcHolding(i);
    return acc + (h ?? 0);
  }, 0));

  const nikkei = summary.nikkeiFutures ?? 0;
  const topix = summary.topixFutures ?? 0;
  const grossFutures = Math.abs(nikkei) + Math.abs(topix);
  const netBuy = buyTotal - sellTotal + nikkei + topix;
  const netBuyRatio = buyTotal > 0 ? netBuy / buyTotal : null;

  const dividendTotal = items.reduce((acc, i) => {
    const d = calcDividendAmount(i);
    return acc + (d ?? 0);
  }, 0);

  const dividendYield = buyTotal > 0 ? dividendTotal / buyTotal : null;

  const tagSummary = TAG_LABELS.map(({ value, label }) => {
    const tagItems = items.filter(i => i.tag === value);
    const total = tagItems.reduce((acc, i) => {
      const h = calcHolding(i);
      return acc + (h ?? 0);
    }, 0);
    const ratio = buyTotal > 0 ? total / buyTotal : null;
    return { label, total, ratio };
  });

  return (
    <div className="summary-section">
      <h2 className="summary-title">サマリー</h2>
      <div className="summary-grid">
        <div className="summary-group">
          <h3>ポジション</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>買いポジ合計</td>
                <td className="num">{fmt(buyTotal)}</td>
              </tr>
              <tr>
                <td>売りポジ合計</td>
                <td className="num">{fmt(sellTotal)}</td>
              </tr>
              <tr className="summary-highlight">
                <td>ネット買いポジ</td>
                <td className="num">{fmt(netBuy)}</td>
              </tr>
              <tr>
                <td>ネット買いポジ比率</td>
                <td className="num">{fmtPct(netBuyRatio)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="summary-group">
          <h3>先物</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>グロ先</td>
                <td className="num">{fmt(grossFutures)}</td>
              </tr>
              <tr>
                <td>日経先物</td>
                <td className="num editable-summary">
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
                <td className="num editable-summary">
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

        <div className="summary-group">
          <h3>配当</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>配当金合計</td>
                <td className="num">{fmt(dividendTotal)}</td>
              </tr>
              <tr>
                <td>配当利回り</td>
                <td className="num">{fmtPct(dividendYield)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="summary-group">
          <h3>タグ別</h3>
          <table className="summary-table">
            <thead>
              <tr>
                <th>タグ</th>
                <th className="num">保有金額</th>
                <th className="num">比率</th>
              </tr>
            </thead>
            <tbody>
              {tagSummary.map(({ label, total, ratio }) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{total > 0 ? fmt(total) : '—'}</td>
                  <td className="num">{total > 0 ? fmtPct(ratio) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
