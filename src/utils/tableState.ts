import type { PortfolioItem } from '../types';

// ─── Column Keys ────────────────────────────────────────────────────────────
export type ColKey =
  | 'code' | 'name' | 'price' | 'shares' | 'holding' | 'ratio'
  | 'plannedShares' | 'plannedMarketValue' | 'plannedWeight'
  | 'plannedDelta' | 'afterAmount' | 'afterRatio'
  | 'settlement' | 'tech' | 'topix'
  | 'border' | 'divergence' | 'targetPrice' | 'targetPeriod' | 'upside'
  | 'fx' | 'inflation' | 'ir' | 'per'
  | 'management' | 'competitiveness' | 'governance'
  | 'netCash' | 'netPer'
  | 'marchDiv' | 'dividend' | 'divAmount' | 'divYield'
  | 'benefit' | 'benefitYield'
  | 'tag' | 'memo';

export interface ColDef {
  key: ColKey;
  label: string;
  width: number;
}

export const ALL_COLS: ColDef[] = [
  { key: 'code',              label: 'コード',      width: 52 },
  { key: 'name',              label: '銘柄名',      width: 90 },
  { key: 'price',             label: '株価',        width: 60 },
  { key: 'shares',            label: '株数',        width: 52 },
  { key: 'holding',           label: '保有金額',    width: 78 },
  { key: 'ratio',             label: '割合',        width: 50 },
  // rebalance plan columns
  { key: 'plannedShares',     label: '予定株数',    width: 54 },
  { key: 'plannedMarketValue',label: '予定後金額',  width: 78 },
  { key: 'plannedWeight',     label: '予定後割合',  width: 60 },
  // legacy delta columns
  { key: 'plannedDelta',      label: '増減株数',    width: 54 },
  { key: 'afterAmount',       label: '増減後額',    width: 76 },
  { key: 'afterRatio',        label: '増減後%',     width: 54 },
  { key: 'settlement',        label: '決算',        width: 44 },
  { key: 'tech',              label: 'テク',        width: 38 },
  { key: 'topix',             label: 'TOPIX',       width: 38 },
  { key: 'border',            label: 'ボーダー',    width: 64 },
  { key: 'divergence',        label: '乖離率',      width: 54 },
  { key: 'targetPrice',       label: '目標株価',    width: 66 },
  { key: 'targetPeriod',      label: '目標期間',    width: 52 },
  { key: 'upside',            label: '上値余地',    width: 54 },
  { key: 'fx',                label: '為替',        width: 46 },
  { key: 'inflation',         label: 'インフレ',    width: 38 },
  { key: 'ir',                label: 'IR',          width: 38 },
  { key: 'per',               label: 'PER',         width: 46 },
  { key: 'management',        label: '経営者',      width: 38 },
  { key: 'competitiveness',   label: '競争力',      width: 38 },
  { key: 'governance',        label: 'ガバ',        width: 38 },
  { key: 'netCash',           label: 'ネットC',     width: 64 },
  { key: 'netPer',            label: 'ネットPER',   width: 52 },
  { key: 'marchDiv',          label: '3月配当',     width: 46 },
  { key: 'dividend',          label: '配当',        width: 46 },
  { key: 'divAmount',         label: '配当金',      width: 64 },
  { key: 'divYield',          label: '配当利回',    width: 58 },
  { key: 'benefit',           label: '優待',        width: 44 },
  { key: 'benefitYield',      label: '優待利回',    width: 58 },
  { key: 'tag',               label: 'タグ',        width: 38 },
  { key: 'memo',              label: 'メモ',        width: 120 },
];

// ─── Column Presets ──────────────────────────────────────────────────────────
export type PresetName = 'basic' | 'investment' | 'dividend' | 'all';

export const COL_PRESETS: Record<PresetName, Set<ColKey>> = {
  basic: new Set<ColKey>([
    'code', 'name', 'price', 'shares', 'holding', 'ratio',
    'plannedShares', 'plannedMarketValue', 'plannedWeight',
    'targetPrice', 'upside', 'memo',
  ]),
  investment: new Set<ColKey>([
    'code', 'name', 'price', 'shares', 'holding', 'ratio',
    'plannedShares', 'plannedMarketValue', 'plannedWeight',
    'settlement', 'tech', 'topix',
    'border', 'divergence', 'targetPrice', 'targetPeriod', 'upside',
    'fx', 'inflation', 'ir', 'per',
    'management', 'competitiveness', 'governance',
    'memo',
  ]),
  dividend: new Set<ColKey>([
    'code', 'name', 'price', 'shares', 'holding', 'ratio',
    'plannedShares', 'plannedMarketValue', 'plannedWeight',
    'dividend', 'divAmount', 'divYield', 'benefit', 'benefitYield',
  ]),
  all: new Set<ColKey>(ALL_COLS.map(c => c.key)),
};

// ─── Sort ────────────────────────────────────────────────────────────────────
export type SortKey = 'code' | 'name' | 'holding' | 'ratio' | 'targetPrice' | 'upside' | 'dividendYield' | 'settlementMonth';
export type SortDir = 'asc' | 'desc';
export interface SortState { key: SortKey; dir: SortDir; }
export const DEFAULT_SORT: SortState = { key: 'holding', dir: 'desc' };

export const COL_SORT_KEY: Partial<Record<ColKey, SortKey>> = {
  code: 'code',
  name: 'name',
  holding: 'holding',
  ratio: 'ratio',
  targetPrice: 'targetPrice',
  upside: 'upside',
  divYield: 'dividendYield',
  settlement: 'settlementMonth',
};

function safeN(n: number | null | undefined): number {
  if (n == null || isNaN(n) || !isFinite(n)) return 0;
  return n;
}

function calcHoldingN(item: PortfolioItem): number {
  return safeN(item.price) * safeN(item.shares);
}

function calcUpsideN(item: PortfolioItem): number {
  if (item.targetPrice == null || item.price == null || item.price === 0) return -Infinity;
  return item.targetPrice / item.price - 1;
}

function calcDivYieldN(item: PortfolioItem): number {
  if (item.dividend == null || item.price == null || item.price === 0) return -Infinity;
  return item.dividend / item.price;
}

export function sortItems(items: PortfolioItem[], sort: SortState, totalBuy: number): PortfolioItem[] {
  return [...items].sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;

    switch (sort.key) {
      case 'code':            av = a.code;           bv = b.code;           break;
      case 'name':            av = a.name;           bv = b.name;           break;
      case 'holding':         av = calcHoldingN(a);  bv = calcHoldingN(b);  break;
      case 'ratio': {
        av = totalBuy > 0 ? calcHoldingN(a) / totalBuy : calcHoldingN(a);
        bv = totalBuy > 0 ? calcHoldingN(b) / totalBuy : calcHoldingN(b);
        break;
      }
      case 'targetPrice':     av = a.targetPrice ?? -Infinity; bv = b.targetPrice ?? -Infinity; break;
      case 'upside':          av = calcUpsideN(a);   bv = calcUpsideN(b);   break;
      case 'dividendYield':   av = calcDivYieldN(a); bv = calcDivYieldN(b); break;
      case 'settlementMonth': av = a.settlementMonth; bv = b.settlementMonth; break;
    }

    if (typeof av === 'string' && typeof bv === 'string') {
      const cmp = av.localeCompare(bv, 'ja');
      return sort.dir === 'asc' ? cmp : -cmp;
    }
    const an = av as number, bn = bv as number;
    if (an < bn) return sort.dir === 'asc' ? -1 : 1;
    if (an > bn) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ─── Filter ──────────────────────────────────────────────────────────────────
export interface FilterState {
  search: string;
  settlementMonth: string;
  tech: string;
  topix: string;
  fx: string;
  inflation: string;
  ir: string;
  management: string;
  competitiveness: string;
  governance: string;
  upsideOnly: boolean;
  dividendOnly: boolean;
  plannedChangeOnly: boolean; // show only items where plannedShares ≠ shares
}

export const DEFAULT_FILTER: FilterState = {
  search: '', settlementMonth: '', tech: '', topix: '', fx: '',
  inflation: '', ir: '', management: '', competitiveness: '', governance: '',
  upsideOnly: false, dividendOnly: false, plannedChangeOnly: false,
};

export function filterItems(items: PortfolioItem[], f: FilterState): PortfolioItem[] {
  return items.filter(item => {
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!item.code.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
    }
    if (f.settlementMonth && item.settlementMonth !== f.settlementMonth) return false;
    if (f.tech && item.tech !== f.tech) return false;
    if (f.topix && item.topix !== f.topix) return false;
    if (f.fx && item.fx !== f.fx) return false;
    if (f.inflation && item.inflation !== f.inflation) return false;
    if (f.ir && item.ir !== f.ir) return false;
    if (f.management && item.management !== f.management) return false;
    if (f.competitiveness && item.competitiveness !== f.competitiveness) return false;
    if (f.governance && item.governance !== f.governance) return false;
    if (f.upsideOnly) {
      const u = item.targetPrice != null && item.price != null && item.price > 0
        ? item.targetPrice / item.price - 1 : null;
      if (u == null || u <= 0) return false;
    }
    if (f.dividendOnly) {
      const y = item.dividend != null && item.price != null && item.price > 0
        ? item.dividend / item.price : null;
      if (y == null || y <= 0) return false;
    }
    if (f.plannedChangeOnly) {
      // Show only items where plannedShares is set AND differs from current shares
      if (item.plannedShares == null) return false;
      if (item.plannedShares === item.shares) return false;
    }
    return true;
  });
}

export function isFilterActive(f: FilterState): boolean {
  return f.search !== '' || f.settlementMonth !== '' || f.tech !== '' || f.topix !== ''
    || f.fx !== '' || f.inflation !== '' || f.ir !== '' || f.management !== ''
    || f.competitiveness !== '' || f.governance !== '' || f.upsideOnly || f.dividendOnly
    || f.plannedChangeOnly;
}
