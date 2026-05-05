import { useState, useRef } from 'react';
import type { PortfolioItem, TagValue, FxValue, PeriodValue } from '../types';

interface Props {
  items: PortfolioItem[];
  onUpdate: (id: string, updates: Partial<PortfolioItem>) => void;
  onRemove: (id: string) => void;
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

  function renderTextCell(item: PortfolioItem, key: keyof PortfolioItem, display: string, width = 80) {
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

  function renderNumCell(item: PortfolioItem, key: keyof PortfolioItem, value: number | null, width = 72) {
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
    width = 60,
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

  function renderCalcCell(display: string, extraClass = '', width = 80) {
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
            <th className="sticky-col sticky-col-1" style={{ minWidth: 60 }}>コード</th>
            <th className="sticky-col sticky-col-2" style={{ minWidth: 120 }}>銘柄名</th>
            <th style={{ minWidth: 72 }}>株価</th>
            <th style={{ minWidth: 60 }}>株数</th>
            <th style={{ minWidth: 90 }}>保有金額</th>
            <th style={{ minWidth: 64 }}>割合</th>
            <th style={{ minWidth: 80 }}>増減予定株数</th>
            <th style={{ minWidth: 90 }}>増減後金額</th>
            <th style={{ minWidth: 72 }}>増減後割合</th>
            <th style={{ minWidth: 60 }}>決算月</th>
            <th style={{ minWidth: 52 }}>テク</th>
            <th style={{ minWidth: 52 }}>TOPIX</th>
            <th style={{ minWidth: 80 }}>ボーダー株価</th>
            <th style={{ minWidth: 70 }}>乖離率</th>
            <th style={{ minWidth: 80 }}>目標株価</th>
            <th style={{ minWidth: 72 }}>目標期間</th>
            <th style={{ minWidth: 72 }}>上値余地</th>
            <th style={{ minWidth: 60 }}>為替</th>
            <th style={{ minWidth: 60 }}>インフレ</th>
            <th style={{ minWidth: 52 }}>IR</th>
            <th style={{ minWidth: 60 }}>PER</th>
            <th style={{ minWidth: 52 }}>経営者</th>
            <th style={{ minWidth: 52 }}>競争力</th>
            <th style={{ minWidth: 72 }}>ガバナンス</th>
            <th style={{ minWidth: 80 }}>ネットキャッシュ</th>
            <th style={{ minWidth: 64 }}>ネットPER</th>
            <th style={{ minWidth: 60 }}>3月配当</th>
            <th style={{ minWidth: 60 }}>配当</th>
            <th style={{ minWidth: 80 }}>配当金</th>
            <th style={{ minWidth: 72 }}>配当利回り</th>
            <th style={{ minWidth: 60 }}>優待</th>
            <th style={{ minWidth: 72 }}>優待利回り</th>
            <th style={{ minWidth: 52 }}>タグ</th>
            <th style={{ minWidth: 160 }}>メモ</th>
            <th style={{ minWidth: 44 }}></th>
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
                  className={`sticky-col sticky-col-1 editable`}
                  style={{ minWidth: 60 }}
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
                {/* 銘柄名: sticky */}
                <td
                  className={`sticky-col sticky-col-2 editable`}
                  style={{ minWidth: 120 }}
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
                    item.name || <span className="empty-cell">—</span>
                  )}
                </td>

                {/* 株価: editable + shows error */}
                <td
                  className={`editable num ${item.priceError ? 'price-error' : ''}`}
                  style={{ minWidth: 72 }}
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

                {renderNumCell(item, 'shares', item.shares, 60)}
                {renderCalcCell(fmt(holding), '', 90)}
                {renderCalcCell(fmtPct(ratio), '', 64)}
                {renderNumCell(item, 'plannedDelta', item.plannedDelta, 80)}
                {renderCalcCell(fmt(afterAmount), '', 90)}
                {renderCalcCell(fmtPct(afterRatio), '', 72)}
                {renderTextCell(item, 'settlementMonth', item.settlementMonth, 60)}
                {renderSelectCell(item, 'tech', TAG_OPTIONS, item.tech, 52)}
                {renderSelectCell(item, 'topix', TAG_OPTIONS, item.topix, 52)}
                {renderNumCell(item, 'borderPrice', item.borderPrice, 80)}
                {renderCalcCell(fmtPct(divergence), divergenceColor(divergence), 70)}
                {renderNumCell(item, 'targetPrice', item.targetPrice, 80)}
                {renderSelectCell(item, 'targetPeriod', PERIOD_OPTIONS, item.targetPeriod, 72)}
                {renderCalcCell(fmtPct(upside), upsideColor(upside), 72)}
                {renderSelectCell(item, 'fx', FX_OPTIONS, item.fx, 60)}
                {renderSelectCell(item, 'inflation', TAG_OPTIONS, item.inflation, 60)}
                {renderSelectCell(item, 'ir', TAG_OPTIONS, item.ir, 52)}
                {renderNumCell(item, 'per', item.per, 60)}
                {renderSelectCell(item, 'management', TAG_OPTIONS, item.management, 52)}
                {renderSelectCell(item, 'competitiveness', TAG_OPTIONS, item.competitiveness, 52)}
                {renderSelectCell(item, 'governance', TAG_OPTIONS, item.governance, 72)}
                {renderNumCell(item, 'netCash', item.netCash, 80)}
                {renderCalcCell(fmt(netPer, 1), '', 64)}
                {renderNumCell(item, 'marchDividend', item.marchDividend, 60)}
                {renderNumCell(item, 'dividend', item.dividend, 60)}
                {renderCalcCell(fmt(dividendAmount), '', 80)}
                {renderCalcCell(fmtPct(dividendYield), '', 72)}
                {renderNumCell(item, 'benefit', item.benefit, 60)}
                {renderCalcCell(fmtPct(benefitYield), '', 72)}
                {renderSelectCell(item, 'tag', TAG_OPTIONS, item.tag, 52)}
                {renderTextCell(item, 'memo', item.memo, 160)}
                <td style={{ minWidth: 44, textAlign: 'center' }}>
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
