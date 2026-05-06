export type TagValue = '◎' | '○' | '△' | '×' | '';
export type FxValue = '円高' | '円安' | '';
export type PeriodValue = '3ヶ月' | '半年' | '1年' | '2年' | '';
export type PriceUpdateStatus = 'success' | 'failed' | 'skipped' | 'manual' | 'unknown';

export interface PortfolioItem {
  id: string;
  code: string;
  name: string;
  price: number | null;
  shares: number | null;
  plannedDelta: number | null;
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

export interface SummaryExtras {
  nikkeiFutures: number | null;
  topixFutures: number | null;
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
