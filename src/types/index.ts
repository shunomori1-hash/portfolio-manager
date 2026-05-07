export type TagValue = '◎' | '○' | '△' | '×' | '';
export type FxValue = '円高' | '円安' | '';
export type PeriodValue = '3ヶ月' | '半年' | '1年' | '2年' | '';
export type PriceUpdateStatus = 'success' | 'failed' | 'skipped' | 'manual' | 'unknown';
export type PortfolioId = 'personal' | 'company';
export const PORTFOLIO_LABELS: Record<PortfolioId, string> = { personal: '個人用', company: '会社用' };

export interface PortfolioItem {
  id: string;
  code: string;
  name: string;
  price: number | null;
  shares: number | null;
  plannedShares: number | null;   // rebalance plan: target share count (not a delta)
  plannedDelta: number | null;    // legacy field kept for compat
  settlementMonth: string;
  tech: TagValue;
  topix: TagValue;
  borderPrice: number | null;
  targetPrice: number | null;
  targetPeriod: PeriodValue;
  fx: FxValue;
  inflation: TagValue;
  ir: TagValue;
  per: number | null;
  management: TagValue;
  competitiveness: TagValue;
  governance: TagValue;
  netCash: number | null;
  marchDividend: number | null;
  dividend: number | null;
  benefit: number | null;
  memo: string;
  tag: TagValue;
  // price update tracking
  priceUpdatedAt: string | null;
  priceError: string | null;
  priceUpdateStatus: PriceUpdateStatus;
  previousPrice: number | null;
}

// ─── Futures hedge data ──────────────────────────────────────────────────────

export type FuturesUpdateStatus = 'success' | 'failed' | 'manual' | 'unknown';

export interface FuturesPosition {
  price: number | null;               // 先物価格
  lots: number | null;                // 枚数（売りヘッジはプラス）
  multiplier: number;                 // 乗数（変更可能）
  // fetch metadata
  source: string;                     // 'nikkei225jp' | 'yahoo-finance' | 'manual'
  symbol: string;                     // 'c=138' | 'NIY=F' | 'TPY=F' など
  lastUpdatedAt: string | null;       // ISO timestamp
  updateStatus: FuturesUpdateStatus;
  updateError: string | null;
}

export interface HedgeFutures {
  grossNikkei: FuturesPosition;  // グロ先（例: 日経225ミニ、乗数100）
  nikkei: FuturesPosition;       // 日経先物（乗数1000）
  topix: FuturesPosition;        // TOPIX先物（乗数10000）
}

// ─── Summary extras ───────────────────────────────────────────────────────────

export interface SummaryExtras {
  nikkeiFutures: number | null;  // legacy: kept for compat (not used in new calc)
  topixFutures: number | null;   // legacy: kept for compat (not used in new calc)
  totalAssets: number | null;    // user's total asset value for ratio calculations
  hedgeFutures: HedgeFutures;    // futures hedge positions
}

export interface Portfolio {
  items: PortfolioItem[];
  summary: SummaryExtras;
  lastSaved: string | null;
}

export interface PriceFetchResult {
  code: string;
  price: number | null;
  error: string | null;
}

export interface PriceFetchResponse {
  results: PriceFetchResult[];
  updatedAt: string;
  error?: string;
}

export interface PriceUpdateLogEntry {
  timestamp: string;
  code: string;
  name: string;
  prevPrice: number | null;
  newPrice: number | null;
  status: 'success' | 'failed' | 'skipped';
  error: string | null;
}

export interface PriceUpdateSummary {
  updatedAt: string;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failedItems: { code: string; name: string; error: string }[];
}
