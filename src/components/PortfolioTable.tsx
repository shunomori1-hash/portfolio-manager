import { useState, useRef } from 'react';
import type { PortfolioItem, TagValue, FxValue, PeriodValue } from '../types';
import { ALL_COLS, type ColKey, type SortState, type SortKey, COL_SORT_KEY } from '../utils/tableState';

interface Props {
  items: PortfolioItem[];
  onUpdate: (id: string, updates: Partial<PortfolioItem>) => void;
  onUpdatePrice: (id: string, price: number | null) => void;
  onRefreshPrice: (id: string, code: string) => void;
  onRemove: (id: string) => void;
  visibleCols: Set<ColKey>;
  sortState: SortState;
  onSort: (key: SortKey) => void;
  fetchingPriceItemId: string | null;
  totalAssets: number | null;  // user's total asset value for ratio columns
}

const TAG_OPTIONS: TagValue[] = ['◎', '○', '△', '×', ''];
const FX_OPTIONS: FxValue[] = ['円高', '円安', ''];
const PERIOD_OPTIONS: PeriodValue[] = ['3ヶ月', '半年', '1年', '2年', ''];

// ─── Safe number helper ──────────────────────────────────────────────────────
function safeN(n: number | null | undefined): number | null {
  if (n == null || isNaN(n) || !isFinite(n)) return null;
  return n;
}

// ─── Calc helpers ────────────────────────────────────────────────────────────
function calcHolding(item: PortfolioItem) {
  const p = safeN(item.price), s = safeN(item.shares);
  if (p == null || s == null) return null;
  return p * s;
}

function calcAfterAmount(item: PortfolioItem) {
  const p = safeN(item.price);
  if (p == null) return null;
  const afterShares = (safeN(item.shares) ?? 0) + (safeN(item.plannedDelta) ?? 0);
  return p * afterShares;
}

function calcUpside(item: PortfolioItem) {
  const tp = safeN(item.targetPrice), p = safeN(item.price);
  if (tp == null || p == null || p === 0) return null;
  return tp / p - 1;
}

function calcDivergence(item: PortfolioItem) {
  const bp = safeN(item.borderPrice), p = safeN(item.price);
  if (bp == null || p == null || p === 0) return null;
  return bp / p - 1;
}

function calcDividendYield(item: PortfolioItem) {
  const d = safeN(item.dividend), p = safeN(item.price);
  if (d == null || p == null || p === 0) return null;
  return d / p;
}

function calcBenefitYield(item: PortfolioItem) {
  const b = safeN(item.benefit), p = safeN(item.price);
  if (b == null || p == null || p === 0) return null;
  return b / p;
}

function calcNetPer(item: PortfolioItem) {
  const per = safeN(item.per), p = safeN(item.price), nc = safeN(item.netCash);
  if (per == null || p == null || p === 0 || nc == null) return null;
  return per * (p - nc) / p;
}

function calcDividendAmount(item: PortfolioItem) {
  const d = safeN(item.dividend), s = safeN(item.shares);
  if (d == null || s == null) return null;
  return d * s;
}

function calcPlannedMarketValue(item: PortfolioItem) {
  const p = safeN(item.price), ps = safeN(item.plannedShares);
  if (p == null || ps == null || item.plannedShares == null) return null;
  return p * ps;
}

// ─── Format helpers ──────────────────────────────────────────────────────────
function fmt(n: number | null, decimals = 0): string {
  if (n == null) return '';
  return n.toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number | null): string {
  if (n == null) return '';
  return (n * 100).toFixed(1) + '%';
}

// ─── Color helpers ───────────────────────────────────────────────────────────
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

// ─── Column width map ────────────────────────────────────────────────────────
const W: Record<ColKey, number> = Object.fromEntries(ALL_COLS.map(c => [c.key, c.width])) as Record<ColKey, number>;

type EditingCell = { id: string; key: string } | null;

// ─── Sort header cell ────────────────────────────────────────────────────────
function SortTh({
  colKey, label, sortState, onSort, style,
  className = '',
}: {
  colKey: ColKey;
  label: string;
  sortState: SortState;
  onSort: (k: SortKey) => void;
  style?: React.CSSProperties;
  className?: string;
}) {
  const sk = COL_SORT_KEY[colKey];
  const isActive = sk != null && sortState.key === sk;
  return (
    <th
      className={`${className} ${sk ? 'sortable-col' : ''} ${isActive ? 'sort-active' : ''}`}
      style={style}
      onClick={sk ? () => onSort(sk) : undefined}
    >
      {label}
      {sk && (
        <span className="sort-icon">
          {isActive ? (sortState.dir === 'asc' ? '↑' : '↓') : '⇅'}
        </span>
      )}
    </th>
  );
}

// Price status → CSS class
function priceStatusClass(item: PortfolioItem): string {
  if (item.priceUpdateStatus === 'failed') return 'price-error';
  if (item.priceUpdateStatus === 'manual') return 'price-manual';
  return '';
}

export function PortfolioTable({ items, onUpdate, onUpdatePrice, onRefreshPrice, onRemove, visibleCols, sortState, onSort, fetchingPriceItemId, totalAssets }: Props) {
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState('');
  const [editingMemo, setEditingMemo] = useState<string | null>(null); // item id
  const [memoValue, setMemoValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // totalAfterBuy: used for legacy afterRatio column
  const totalAfterBuy = items.reduce((acc, item) => {
    const a = calcAfterAmount(item);
    return acc + (a != null && a > 0 ? a : 0);
  }, 0);

  // ratio and plannedWeight now use totalAssets (user-defined) instead of portfolio total
  const assetBase = totalAssets != null && totalAssets > 0 ? totalAssets : null;

  function startEdit(id: string, key: string, currentValue: string) {
    setEditingCell({ id, key });
    setEditValue(currentValue);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitEdit(id: string, key: keyof PortfolioItem) {
    const numericKeys = [
      'price', 'shares', 'plannedShares', 'plannedDelta', 'borderPrice', 'targetPrice',
      'per', 'netCash', 'marchDividend', 'dividend', 'benefit',
    ];
    let value: string | number | null = editValue.trim();
    if (numericKeys.includes(key)) {
      const n = Number(value.replace(/,/g, ''));
      value = value === '' ? null : (isNaN(n) ? null : n);
    }
    onUpdate(id, { [key]: value } as Partial<PortfolioItem>);
    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, id: string, key: keyof PortfolioItem) {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitEdit(id, key); }
    if (e.key === 'Escape') setEditingCell(null);
  }

  function startMemoEdit(id: string, value: string) {
    setEditingMemo(id);
    setMemoValue(value);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function commitMemo(id: string) {
    onUpdate(id, { memo: memoValue });
    setEditingMemo(null);
  }

  const vis = (k: ColKey) => visibleCols.has(k);

  // ─── Render helpers ─────────────────────────────────────────────────────────
  function renderTextCell(item: PortfolioItem, key: keyof PortfolioItem, display: string, colKey: ColKey) {
    if (!vis(colKey)) return null;
    const w = W[colKey];
    const isEditing = editingCell?.id === item.id && editingCell?.key === key;
    if (isEditing) {
      return (
        <td style={{ minWidth: w, padding: 0 }}>
          <input ref={inputRef} className="cell-input"
            value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(item.id, key)}
            onKeyDown={e => handleKeyDown(e, item.id, key)} />
        </td>
      );
    }
    return (
      <td className="editable" style={{ minWidth: w }}
        onClick={() => startEdit(item.id, key, display)}>
        {display || <span className="empty-cell">—</span>}
      </td>
    );
  }

  function renderNumCell(item: PortfolioItem, key: keyof PortfolioItem, value: number | null, colKey: ColKey, extraClass = '') {
    if (!vis(colKey)) return null;
    const w = W[colKey];
    const isEditing = editingCell?.id === item.id && editingCell?.key === key;
    if (isEditing) {
      return (
        <td style={{ minWidth: w, padding: 0 }}>
          <input ref={inputRef} className="cell-input cell-input-num"
            value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(item.id, key)}
            onKeyDown={e => handleKeyDown(e, item.id, key)} />
        </td>
      );
    }
    return (
      <td className={`editable num ${extraClass}`} style={{ minWidth: w }}
        onClick={() => startEdit(item.id, key, value != null ? String(value) : '')}>
        {fmt(value)}
      </td>
    );
  }

  function renderSelectCell(
    item: PortfolioItem, key: keyof PortfolioItem, options: string[],
    value: string, colKey: ColKey, extraClass = ''
  ) {
    if (!vis(colKey)) return null;
    return (
      <td className={`editable ${extraClass} ${tagColor(value as TagValue)}`} style={{ minWidth: W[colKey] }}>
        <select className="cell-select" value={value}
          onChange={e => onUpdate(item.id, { [key]: e.target.value } as Partial<PortfolioItem>)}>
          {options.map(o => <option key={o} value={o}>{o || '—'}</option>)}
        </select>
      </td>
    );
  }

  function renderCalcCell(display: string, extraClass: string, colKey: ColKey) {
    if (!vis(colKey)) return null;
    return (
      <td className={`calc num ${extraClass}`} style={{ minWidth: W[colKey] }}>
        {display || '—'}
      </td>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="portfolio-table">
        <thead>
          <tr>
            {/* always visible sticky columns */}
            <SortTh colKey="code" label="コード" sortState={sortState} onSort={onSort}
              style={{ minWidth: W.code }} className="sticky-col sticky-col-1" />
            <SortTh colKey="name" label="銘柄名" sortState={sortState} onSort={onSort}
              style={{ minWidth: W.name }} className="sticky-col sticky-col-2" />

            {vis('price')       && <th style={{ minWidth: W.price }}>株価</th>}
            <th style={{ minWidth: 24 }} title="個別再取得">↻</th>
            {vis('shares')      && <th style={{ minWidth: W.shares }}>株数</th>}
            {vis('holding')     && <SortTh colKey="holding" label="保有金額" sortState={sortState} onSort={onSort} style={{ minWidth: W.holding }} />}
            {vis('ratio')       && <SortTh colKey="ratio" label="資産比率" sortState={sortState} onSort={onSort} style={{ minWidth: W.ratio }} />}
            {vis('plannedShares')      && <th style={{ minWidth: W.plannedShares }}>予定株数</th>}
            {vis('plannedMarketValue') && <th style={{ minWidth: W.plannedMarketValue }}>予定後金額</th>}
            {vis('plannedWeight')      && <th style={{ minWidth: W.plannedWeight }}>予定後資産比率</th>}
            {vis('plannedDelta')&& <th style={{ minWidth: W.plannedDelta }}>増減株数</th>}
            {vis('afterAmount') && <th style={{ minWidth: W.afterAmount }}>増減後額</th>}
            {vis('afterRatio')  && <th style={{ minWidth: W.afterRatio }}>増減後%</th>}
            {vis('settlement')  && <SortTh colKey="settlement" label="決算" sortState={sortState} onSort={onSort} style={{ minWidth: W.settlement }} />}
            {vis('tech')        && <th style={{ minWidth: W.tech }}>テク</th>}
            {vis('topix')       && <th style={{ minWidth: W.topix }}>TOPIX</th>}
            {vis('border')      && <th style={{ minWidth: W.border }}>ボーダー</th>}
            {vis('divergence')  && <th style={{ minWidth: W.divergence }}>乖離率</th>}
            {vis('targetPrice') && <SortTh colKey="targetPrice" label="目標株価" sortState={sortState} onSort={onSort} style={{ minWidth: W.targetPrice }} />}
            {vis('targetPeriod')&& <th style={{ minWidth: W.targetPeriod }}>目標期間</th>}
            {vis('upside')      && <SortTh colKey="upside" label="上値余地" sortState={sortState} onSort={onSort} style={{ minWidth: W.upside }} />}
            {vis('fx')          && <th style={{ minWidth: W.fx }}>為替</th>}
            {vis('inflation')   && <th style={{ minWidth: W.inflation }}>インフレ</th>}
            {vis('ir')          && <th style={{ minWidth: W.ir }}>IR</th>}
            {vis('per')         && <th style={{ minWidth: W.per }}>PER</th>}
            {vis('management')  && <th style={{ minWidth: W.management }}>経営者</th>}
            {vis('competitiveness') && <th style={{ minWidth: W.competitiveness }}>競争力</th>}
            {vis('governance')  && <th style={{ minWidth: W.governance }}>ガバ</th>}
            {vis('netCash')     && <th style={{ minWidth: W.netCash }}>ネットC</th>}
            {vis('netPer')      && <th style={{ minWidth: W.netPer }}>ネットPER</th>}
            {vis('marchDiv')    && <th style={{ minWidth: W.marchDiv }}>3月配当</th>}
            {vis('dividend')    && <th style={{ minWidth: W.dividend }}>配当</th>}
            {vis('divAmount')   && <th style={{ minWidth: W.divAmount }}>配当金</th>}
            {vis('divYield')    && <SortTh colKey="divYield" label="配当利回" sortState={sortState} onSort={onSort} style={{ minWidth: W.divYield }} />}
            {vis('benefit')     && <th style={{ minWidth: W.benefit }}>優待</th>}
            {vis('benefitYield')&& <th style={{ minWidth: W.benefitYield }}>優待利回</th>}
            {vis('tag')         && <th style={{ minWidth: W.tag }}>タグ</th>}
            {vis('memo')        && <th style={{ minWidth: W.memo }}>メモ</th>}
            <th style={{ minWidth: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const h = calcHolding(item);
            const ratio = assetBase != null && h != null ? h / assetBase : null;
            const afterAmount = calcAfterAmount(item);
            const afterRatio = totalAfterBuy > 0 && afterAmount != null ? afterAmount / totalAfterBuy : null;
            const plannedMV = calcPlannedMarketValue(item);
            const plannedW = assetBase != null && plannedMV != null ? plannedMV / assetBase : null;
            const upside = calcUpside(item);
            const divergence = calcDivergence(item);
            const divAmount = calcDividendAmount(item);
            const divYield = calcDividendYield(item);
            const benefitYield = calcBenefitYield(item);
            const netPer = calcNetPer(item);

            return (
              <tr key={item.id} className={item.priceError ? 'row-error' : ''}>
                {/* コード sticky */}
                <td className="sticky-col sticky-col-1 editable" style={{ minWidth: W.code }}
                  onClick={() => { if (!(editingCell?.id === item.id && editingCell?.key === 'code')) startEdit(item.id, 'code', item.code); }}>
                  {editingCell?.id === item.id && editingCell?.key === 'code' ? (
                    <input ref={inputRef} className="cell-input" value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(item.id, 'code')}
                      onKeyDown={e => handleKeyDown(e, item.id, 'code')} />
                  ) : (item.code || <span className="empty-cell">—</span>)}
                </td>

                {/* 銘柄名 sticky + ellipsis */}
                <td className="sticky-col sticky-col-2 editable" style={{ minWidth: W.name, maxWidth: 140 }}
                  onClick={() => { if (!(editingCell?.id === item.id && editingCell?.key === 'name')) startEdit(item.id, 'name', item.name); }}>
                  {editingCell?.id === item.id && editingCell?.key === 'name' ? (
                    <input ref={inputRef} className="cell-input" value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(item.id, 'name')}
                      onKeyDown={e => handleKeyDown(e, item.id, 'name')} />
                  ) : (
                    <span className="cell-name" title={item.name}>
                      {item.name || <span className="empty-cell">—</span>}
                    </span>
                  )}
                </td>

                {/* 株価 */}
                {vis('price') && (
                  <td
                    className={`editable num ${priceStatusClass(item)}`}
                    style={{ minWidth: W.price }}
                    title={
                      item.priceError
                        ? `⚠ ${item.priceError}`
                        : item.priceUpdatedAt
                          ? `更新: ${new Date(item.priceUpdatedAt).toLocaleString('ja-JP')}${item.previousPrice != null ? ` (前回: ${item.previousPrice.toLocaleString('ja-JP')})` : ''}`
                          : ''
                    }
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
                        onBlur={() => {
                          const n = editValue.trim() === '' ? null : Number(editValue.replace(/,/g, ''));
                          onUpdatePrice(item.id, (n != null && !isNaN(n) && isFinite(n)) ? n : null);
                          setEditingCell(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            const n = editValue.trim() === '' ? null : Number(editValue.replace(/,/g, ''));
                            onUpdatePrice(item.id, (n != null && !isNaN(n) && isFinite(n)) ? n : null);
                            setEditingCell(null);
                          }
                          if (e.key === 'Escape') setEditingCell(null);
                        }}
                      />
                    ) : (
                      item.priceUpdateStatus === 'failed'
                        ? <span className="error-indicator" title={item.priceError ?? ''}> ⚠ {fmt(item.price)}</span>
                        : item.priceUpdateStatus === 'manual'
                          ? <span title="手動入力">{fmt(item.price)} ✎</span>
                          : fmt(item.price)
                    )}
                  </td>
                )}
                {/* 個別再取得ボタン */}
                <td style={{ minWidth: 24, textAlign: 'center', padding: '0 1px' }}>
                  <button
                    className="btn-refresh"
                    title={`${item.code} の株価を再取得`}
                    disabled={fetchingPriceItemId === item.id || !item.code.trim()}
                    onClick={() => onRefreshPrice(item.id, item.code)}
                  >
                    {fetchingPriceItemId === item.id ? '…' : '↻'}
                  </button>
                </td>

                {renderNumCell(item, 'shares', item.shares, 'shares')}
                {renderCalcCell(fmt(h), '', 'holding')}
                {renderCalcCell(fmtPct(ratio), '', 'ratio')}
                {renderNumCell(item, 'plannedShares', item.plannedShares, 'plannedShares', 'cell-planned')}
                {renderCalcCell(fmt(plannedMV), '', 'plannedMarketValue')}
                {renderCalcCell(fmtPct(plannedW), '', 'plannedWeight')}
                {renderNumCell(item, 'plannedDelta', item.plannedDelta, 'plannedDelta')}
                {renderCalcCell(fmt(afterAmount), '', 'afterAmount')}
                {renderCalcCell(fmtPct(afterRatio), '', 'afterRatio')}
                {renderTextCell(item, 'settlementMonth', item.settlementMonth, 'settlement')}
                {renderSelectCell(item, 'tech', TAG_OPTIONS, item.tech, 'tech')}
                {renderSelectCell(item, 'topix', TAG_OPTIONS, item.topix, 'topix')}
                {renderNumCell(item, 'borderPrice', item.borderPrice, 'border')}
                {renderCalcCell(fmtPct(divergence), divergenceColor(divergence), 'divergence')}
                {renderNumCell(item, 'targetPrice', item.targetPrice, 'targetPrice')}
                {renderSelectCell(item, 'targetPeriod', PERIOD_OPTIONS, item.targetPeriod, 'targetPeriod')}
                {renderCalcCell(fmtPct(upside), upsideColor(upside), 'upside')}
                {renderSelectCell(item, 'fx', FX_OPTIONS, item.fx, 'fx')}
                {renderSelectCell(item, 'inflation', TAG_OPTIONS, item.inflation, 'inflation')}
                {renderSelectCell(item, 'ir', TAG_OPTIONS, item.ir, 'ir')}
                {renderNumCell(item, 'per', item.per, 'per')}
                {renderSelectCell(item, 'management', TAG_OPTIONS, item.management, 'management')}
                {renderSelectCell(item, 'competitiveness', TAG_OPTIONS, item.competitiveness, 'competitiveness')}
                {renderSelectCell(item, 'governance', TAG_OPTIONS, item.governance, 'governance')}
                {renderNumCell(item, 'netCash', item.netCash, 'netCash')}
                {renderCalcCell(fmt(netPer, 1), '', 'netPer')}
                {renderNumCell(item, 'marchDividend', item.marchDividend, 'marchDiv')}
                {renderNumCell(item, 'dividend', item.dividend, 'dividend')}
                {renderCalcCell(fmt(divAmount), '', 'divAmount')}
                {renderCalcCell(fmtPct(divYield), '', 'divYield')}
                {renderNumCell(item, 'benefit', item.benefit, 'benefit')}
                {renderCalcCell(fmtPct(benefitYield), '', 'benefitYield')}
                {renderSelectCell(item, 'tag', TAG_OPTIONS, item.tag, 'tag')}

                {/* メモ: textarea on edit */}
                {vis('memo') && (
                  editingMemo === item.id ? (
                    <td style={{ minWidth: W.memo, padding: 0 }}>
                      <textarea
                        ref={textareaRef}
                        className="cell-memo-edit"
                        value={memoValue}
                        onChange={e => setMemoValue(e.target.value)}
                        onBlur={() => commitMemo(item.id)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setEditingMemo(null);
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitMemo(item.id); }
                        }}
                        rows={3}
                      />
                    </td>
                  ) : (
                    <td className="editable memo-cell" style={{ minWidth: W.memo }}
                      onClick={() => startMemoEdit(item.id, item.memo)}
                      title={item.memo}>
                      <span className="cell-name">{item.memo || <span className="empty-cell">—</span>}</span>
                    </td>
                  )
                )}

                {/* 削除 */}
                <td style={{ minWidth: 30, textAlign: 'center' }}>
                  <button className="btn-remove" title="行を削除"
                    onClick={() => {
                      if (confirm(`この銘柄を削除しますか？この操作は保存後に反映されます。\n[${item.code}] ${item.name}`)) {
                        onRemove(item.id);
                      }
                    }}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
