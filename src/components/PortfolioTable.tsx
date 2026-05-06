import { useState, useRef } from 'react';
import type { PortfolioItem, TagValue, FxValue, PeriodValue } from '../types';

interface Props {
  items: PortfolioItem[];
  onUpdate: (id: string, updates: Partial<PortfolioItem>) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}

const TAG_OPTIONS: TagValue[] = ['◎', '○', '△', '×', ''];
const FX_OPTIONS: FxValue[] = ['円高', '円安', ''];
const PERIOD_OPTIONS: PeriodValue[] = ['3ヶ月', '半年', '1年', '2年', ''];

function calcHolding(item: PortfolioItem) {
  if (item.price == null || item.shares == null) return null;
  return item.price * item.shares;
}

function calcAfterAmount(item: PortfolioItem) {
  if (item.price == null) return null;
  const afterShares = (item.shares ?? 0) + (item.plannedDelta ?? 0);
  return item.price * afterShares;
}

function calcUpside(item: PortfolioItem) {
  if (item.targetPrice == null || item.price == null || item.price === 0) return null;
  return item.targetPrice / item.price - 1;
}

function calcDivergence(item: PortfolioItem) {
  if (item.borderPrice == null || item.price == null || item.price === 0) return null;
  return item.borderPrice / item.price - 1;
}

function calcDividendYield(item: PortfolioItem) {
  if (item.dividend == null || item.price == null || item.price === 0) return null;
  return item.dividend / item.price;
}

function calcBenefitYield(item: PortfolioItem) {
  if (item.benefit == null || item.price == null || item.price === 0) return null;
  return item.benefit / item.price;
}

function calcNetPer(item: PortfolioItem) {
  if (item.per == null || item.price == null || item.price === 0 || item.netCash == null) return null;
  return item.per * (item.price - item.netCash) / item.price;
}

function calcDividendAmount(item: PortfolioItem) {
  if (item.dividend == null || item.shares == null) return null;
  return item.dividend * item.shares;
}

function fmt(n: number | null, decimals = 0): string {
  if (n == null) return '';
  return n.toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number | null): string {
  if (n == null) return '';
  return (n * 100).toFixed(1) + '%';
}

function upsideColor(upside: number | null): string {
  if (upside == null) return '';
  if (upside >= 0.5) return 'cell-upside-high';
  if (upside >= 0.2) return 'cell-upside-mid';
  if (upside < 0) return 'cell-neg';
  return '';
}

function divergenceColor(div: number | null): string {
  if (div == null) return '';
  if (div <= -0.2) return 'cell-divergence-good';
  if (div > 0) return 'cell-neg';
  return '';
}

function tagColor(tag: TagValue): string {
  switch (tag) {
    case '◎': return 'tag-double';
    case '○': return 'tag-single';
    case '△': return 'tag-triangle';
    case '×': return 'tag-cross';
    default: return '';
  }
}

type EditingCell = { id: string; key: string } | null;

// Column widths (compact)
const W = {
  code:         52,
  name:         90,
  price:        60,
  shares:       52,
  holding:      78,
  ratio:        50,
  plannedDelta: 54,
  afterAmount:  76,
  afterRatio:   54,
  settlement:   44,
  tag2:         38, // テク/TOPIX/インフレ/IR/経営者/競争力/ガバ/タグ
  border:       64,
  divergence:   54,
  targetPrice:  66,
  targetPeriod: 52,
  upside:       54,
  fx:           46,
  per:          46,
  netCash:      64,
  netPer:       52,
  marchDiv:     46,
  dividend:     46,
  divAmount:    64,
  divYield:     58,
  benefit:      44,
  benefitYield: 58,
  memo:        120,
  del:          30,
};

export function PortfolioTable({ items, onUpdate, onRemove }: Props) {
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const totalBuy = items.reduce((acc, item) => {
    const h = calcHolding(item);
    return acc + (h != null && h > 0 ? h : 0);
  }, 0);

  const totalAfterBuy = items.reduce((acc, item) => {
    const a = calcAfterAmount(item);
    return acc + (a != null && a > 0 ? a : 0);
  }, 0);

  function startEdit(id: string, key: string, currentValue: string) {
    setEditingCell({ id, key });
    setEditValue(currentValue);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitEdit(id: string, key: keyof PortfolioItem) {
    const numericKeys = [
      'price', 'shares', 'plannedDelta', 'borderPrice', 'targetPrice',
      'per', 'netCash', 'marchDividend', 'dividend', 'benefit',
    ];
    let value: string | number | null = editValue.trim();
    if (numericKeys.includes(key)) {
      value = value === '' ? null : Number(value.replace(/,/g, ''));
      if (value !== null && isNaN(value as number)) value = null;
    }
    onUpdate(id, { [key]: value } as Partial<PortfolioItem>);
    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, id: string, key: keyof PortfolioItem) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit(id, key);
    }
    if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }

  function renderTextCell(item: PortfolioItem, key: keyof PortfolioItem, display: string, width: number) {
    const isEditing = editingCell?.id === item.id && editingCell?.key === key;
    if (isEditing) {
      return (
        <td style={{ minWidth: width, padding: 0 }}>
          <input
            ref={inputRef}
            className="cell-input"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(item.id, key)}
            onKeyDown={e => handleKeyDown(e, item.id, key)}
          />
        </td>
      );
    }
    return (
      <td
        className="editable"
        style={{ minWidth: width }}
        onClick={() => startEdit(item.id, key, display)}
      >
        {display || <span className="empty-cell">—</span>}
      </td>
    );
  }

  function renderNumCell(item: PortfolioItem, key: keyof PortfolioItem, value: number | null, width: number) {
    const isEditing = editingCell?.id === item.id && editingCell?.key === key;
    if (isEditing) {
      return (
        <td style={{ minWidth: width, padding: 0 }}>
          <input
            ref={inputRef}
            className="cell-input cell-input-num"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(item.id, key)}
            onKeyDown={e => handleKeyDown(e, item.id, key)}
          />
        </td>
      );
    }
    return (
      <td
        className="editable num"
        style={{ minWidth: width }}
        onClick={() => startEdit(item.id, key, value != null ? String(value) : '')}
      >
        {fmt(value)}
      </td>
    );
  }

  function renderSelectCell(
    item: PortfolioItem,
    key: keyof PortfolioItem,
    options: string[],
    value: string,
    width: number,
    extraClass = ''
  ) {
    return (
      <td className={`editable ${extraClass} ${tagColor(value as TagValue)}`} style={{ minWidth: width }}>
        <select
          className="cell-select"
          value={value}
          onChange={e => onUpdate(item.id, { [key]: e.target.value } as Partial<PortfolioItem>)}
        >
          {options.map(o => <option key={o} value={o}>{o || '—'}</option>)}
        </select>
      </td>
    );
  }

  function renderCalcCell(display: string, extraClass = '', width: number) {
    return (
      <td className={`calc num ${extraClass}`} style={{ minWidth: width }}>
        {display || '—'}
      </td>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="portfolio-table">
        <thead>
          <tr>
            <th className="sticky-col sticky-col-1" style={{ minWidth: W.code }}>コード</th>
            <th className="sticky-col sticky-col-2" style={{ minWidth: W.name }}>銘柄名</th>
            <th style={{ minWidth: W.price }}>株価</th>
            <th style={{ minWidth: W.shares }}>株数</th>
            <th style={{ minWidth: W.holding }}>保有金額</th>
            <th style={{ minWidth: W.ratio }}>割合</th>
            <th style={{ minWidth: W.plannedDelta }}>増減株数</th>
            <th style={{ minWidth: W.afterAmount }}>増減後額</th>
            <th style={{ minWidth: W.afterRatio }}>増減後%</th>
            <th style={{ minWidth: W.settlement }}>決算</th>
            <th style={{ minWidth: W.tag2 }}>テク</th>
            <th style={{ minWidth: W.tag2 }}>TOPIX</th>
            <th style={{ minWidth: W.border }}>ボーダー</th>
            <th style={{ minWidth: W.divergence }}>乖離率</th>
            <th style={{ minWidth: W.targetPrice }}>目標株価</th>
            <th style={{ minWidth: W.targetPeriod }}>目標期間</th>
            <th style={{ minWidth: W.upside }}>上値余地</th>
            <th style={{ minWidth: W.fx }}>為替</th>
            <th style={{ minWidth: W.tag2 }}>インフレ</th>
            <th style={{ minWidth: W.tag2 }}>IR</th>
            <th style={{ minWidth: W.per }}>PER</th>
            <th style={{ minWidth: W.tag2 }}>経営者</th>
            <th style={{ minWidth: W.tag2 }}>競争力</th>
            <th style={{ minWidth: W.tag2 }}>ガバ</th>
            <th style={{ minWidth: W.netCash }}>ネットC</th>
            <th style={{ minWidth: W.netPer }}>ネットPER</th>
            <th style={{ minWidth: W.marchDiv }}>3月配当</th>
            <th style={{ minWidth: W.dividend }}>配当</th>
            <th style={{ minWidth: W.divAmount }}>配当金</th>
            <th style={{ minWidth: W.divYield }}>配当利回</th>
            <th style={{ minWidth: W.benefit }}>優待</th>
            <th style={{ minWidth: W.benefitYield }}>優待利回</th>
            <th style={{ minWidth: W.tag2 }}>タグ</th>
            <th style={{ minWidth: W.memo }}>メモ</th>
            <th style={{ minWidth: W.del }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const holding = calcHolding(item);
            const ratio = totalBuy > 0 && holding != null ? holding / totalBuy : null;
            const afterAmount = calcAfterAmount(item);
            const afterRatio = totalAfterBuy > 0 && afterAmount != null ? afterAmount / totalAfterBuy : null;
            const upside = calcUpside(item);
            const divergence = calcDivergence(item);
            const dividendAmount = calcDividendAmount(item);
            const dividendYield = calcDividendYield(item);
            const benefitYield = calcBenefitYield(item);
            const netPer = calcNetPer(item);

            return (
              <tr key={item.id} className={item.priceError ? 'row-error' : ''}>
                {/* コード: sticky */}
                <td
                  className="sticky-col sticky-col-1 editable"
                  style={{ minWidth: W.code }}
                  onClick={() => {
                    if (!(editingCell?.id === item.id && editingCell?.key === 'code')) {
                      startEdit(item.id, 'code', item.code);
                    }
                  }}
                >
                  {editingCell?.id === item.id && editingCell?.key === 'code' ? (
                    <input
                      ref={inputRef}
                      className="cell-input"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(item.id, 'code')}
                      onKeyDown={e => handleKeyDown(e, item.id, 'code')}
                    />
                  ) : (
                    item.code || <span className="empty-cell">—</span>
                  )}
                </td>

                {/* 銘柄名: sticky + ellipsis */}
                <td
                  className="sticky-col sticky-col-2 editable"
                  style={{ minWidth: W.name, maxWidth: 140 }}
                  onClick={() => {
                    if (!(editingCell?.id === item.id && editingCell?.key === 'name')) {
                      startEdit(item.id, 'name', item.name);
                    }
                  }}
                >
                  {editingCell?.id === item.id && editingCell?.key === 'name' ? (
                    <input
                      ref={inputRef}
                      className="cell-input"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(item.id, 'name')}
                      onKeyDown={e => handleKeyDown(e, item.id, 'name')}
                    />
                  ) : (
                    <span className="cell-name" title={item.name}>
                      {item.name || <span className="empty-cell">—</span>}
                    </span>
                  )}
                </td>

                {/* 株価: editable + shows error */}
                <td
                  className={`editable num ${item.priceError ? 'price-error' : ''}`}
                  style={{ minWidth: W.price }}
                  title={item.priceError ?? (item.priceUpdatedAt ? `更新: ${new Date(item.priceUpdatedAt).toLocaleString('ja-JP')}` : '')}
                  onClick={() => {
                    if (!(editingCell?.id === item.id && editingCell?.key === 'price')) {
                      startEdit(item.id, 'price', item.price != null ? String(item.price) : '');
                    }
                  }}
                >
                  {editingCell?.id === item.id && editingCell?.key === 'price' ? (
                    <input
                      ref={inputRef}
                      className="cell-input cell-input-num"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(item.id, 'price')}
                      onKeyDown={e => handleKeyDown(e, item.id, 'price')}
                    />
                  ) : (
                    item.priceError ? (
                      <span className="error-indicator" title={item.priceError}>⚠ {fmt(item.price)}</span>
                    ) : fmt(item.price)
                  )}
                </td>

                {renderNumCell(item, 'shares', item.shares, W.shares)}
                {renderCalcCell(fmt(holding), '', W.holding)}
                {renderCalcCell(fmtPct(ratio), '', W.ratio)}
                {renderNumCell(item, 'plannedDelta', item.plannedDelta, W.plannedDelta)}
                {renderCalcCell(fmt(afterAmount), '', W.afterAmount)}
                {renderCalcCell(fmtPct(afterRatio), '', W.afterRatio)}
                {renderTextCell(item, 'settlementMonth', item.settlementMonth, W.settlement)}
                {renderSelectCell(item, 'tech', TAG_OPTIONS, item.tech, W.tag2)}
                {renderSelectCell(item, 'topix', TAG_OPTIONS, item.topix, W.tag2)}
                {renderNumCell(item, 'borderPrice', item.borderPrice, W.border)}
                {renderCalcCell(fmtPct(divergence), divergenceColor(divergence), W.divergence)}
                {renderNumCell(item, 'targetPrice', item.targetPrice, W.targetPrice)}
                {renderSelectCell(item, 'targetPeriod', PERIOD_OPTIONS, item.targetPeriod, W.targetPeriod)}
                {renderCalcCell(fmtPct(upside), upsideColor(upside), W.upside)}
                {renderSelectCell(item, 'fx', FX_OPTIONS, item.fx, W.fx)}
                {renderSelectCell(item, 'inflation', TAG_OPTIONS, item.inflation, W.tag2)}
                {renderSelectCell(item, 'ir', TAG_OPTIONS, item.ir, W.tag2)}
                {renderNumCell(item, 'per', item.per, W.per)}
                {renderSelectCell(item, 'management', TAG_OPTIONS, item.management, W.tag2)}
                {renderSelectCell(item, 'competitiveness', TAG_OPTIONS, item.competitiveness, W.tag2)}
                {renderSelectCell(item, 'governance', TAG_OPTIONS, item.governance, W.tag2)}
                {renderNumCell(item, 'netCash', item.netCash, W.netCash)}
                {renderCalcCell(fmt(netPer, 1), '', W.netPer)}
                {renderNumCell(item, 'marchDividend', item.marchDividend, W.marchDiv)}
                {renderNumCell(item, 'dividend', item.dividend, W.dividend)}
                {renderCalcCell(fmt(dividendAmount), '', W.divAmount)}
                {renderCalcCell(fmtPct(dividendYield), '', W.divYield)}
                {renderNumCell(item, 'benefit', item.benefit, W.benefit)}
                {renderCalcCell(fmtPct(benefitYield), '', W.benefitYield)}
                {renderSelectCell(item, 'tag', TAG_OPTIONS, item.tag, W.tag2)}
                {renderTextCell(item, 'memo', item.memo, W.memo)}
                <td style={{ minWidth: W.del, textAlign: 'center' }}>
                  <button
                    className="btn-remove"
                    onClick={() => {
                      if (confirm(`${item.name || item.code} を削除しますか？`)) {
                        onRemove(item.id);
                      }
                    }}
                    title="行を削除"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
