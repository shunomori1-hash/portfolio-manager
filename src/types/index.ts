export type TagValue = '◎' | '○' | '△' | '×' | '';
export type TechRating = '☆' | '◎' | '○' | '△' | '×' | '';
export type FxValue = '円高' | '円安' | '';
export type PeriodValue = '3ヶ月' | '半年' | '1年' | '2年' | '';
export type PriceUpdateStatus = 'success' | 'failed' | 'skipped' | 'manual' | 'unknown';
export type FiscalMonthUpdateStatus = 'success' | 'failed' | 'manual' | 'unknown';
export type TechUpdateStatus = 'success' | 'failed' | 'insufficient_data' | 'cached' | 'unknown';
export type NameUpdateStatus = 'success' | 'failed' | 'manual' | 'unknown';
export type NameSource = 'manual' | 'import' | 'override' | 'jpx' | 'master' | 'yahoo' | 'unknown';
export type PortfolioId = 'personal' | 'company';
export const PORTFOLIO_LABELS: Record<PortfolioId, string> = { personal: '個人用', company: '会社用' };

export interface PortfolioItem {
  id: string;
  code: string;
  name: string;
  price: number | null;
  shares: number | null;
  plannedShares: number | null;
  plannedDelta: number | null;
  settlementMonth: string;
  tech: TechRating;           // displayed in テク column (hand-entry or auto-filled)
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
  // fiscal month auto-fill tracking
  fiscalMonthUpdateStatus: FiscalMonthUpdateStatus;
  fiscalMonthUpdateError: string | null;
  lastFiscalMonthUpdatedAt: string | null;
  // technical auto-rating
  techAutoRating: TechRating;
  techRatingBeforeBreakout: TechRating | null;
  techBreakoutBoosted: boolean;
  techReason: string;
  techUpdatedAt: string | null;
  techUpdateStatus: TechUpdateStatus;
  techUpdateError: string | null;
  // company name auto-fill tracking
  nameSource: NameSource;       // where the name came from
  nameUpdateStatus: NameUpdateStatus;
  nameUpdateError: string | null;
  nameUpdatedAt: string | null;
}

// ─── Futures hedge data ──────────────────────────────────────────────────────

export type FuturesUpdateStatus = 'success' | 'failed' | 'manual' | 'unknown';

export interface FuturesPosition {
  price: number | null;
  lots: number | null;
  multiplier: number;
  source: string;
  symbol: string;
  lastUpdatedAt: string | null;
  updateStatus: FuturesUpdateStatus;
  updateError: string | null;
}

export interface HedgeFutures {
  grossNikkei: FuturesPosition;
  nikkei: FuturesPosition;
  topix: FuturesPosition;
}

// ─── Summary extras ───────────────────────────────────────────────────────────

export interface SummaryExtras {
  nikkeiFutures: number | null;
  topixFutures: number | null;
  totalAssets: number | null;
  hedgeFutures: HedgeFutures;
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
  fiscalMonth?: {
    successCount: number;
    failedCount: number;
    skippedCount: number;
  };
  companyName?: {
    filledCount: number;       // blank → filled from override/master
    correctionCount: number;   // yahoo-named → corrected by override/master
    unregisteredCount: number; // blank → stayed blank (not in override/master)
    skippedCount: number;      // had name already (not writable)
  };
}

// ─── Fiscal month fetch ───────────────────────────────────────────────────────

export interface FiscalMonthFetchResult {
  code: string;
  month: number | null;
  monthStr: string | null;
  source: string;
  error: string | null;
}

export interface FiscalMonthFetchResponse {
  results: FiscalMonthFetchResult[];
  fetchedAt: string;
}

export interface FiscalMonthLogEntry {
  updatedAt: string;
  portfolioId: string;
  code: string;
  name: string;
  previousFiscalMonth: string;
  newFiscalMonth: string | null;
  status: 'success' | 'failed' | 'skipped';
  source: string;
  error: string | null;
}

// ─── Technical auto-rating ───────────────────────────────────────────────────

export interface TechnicalUpdateResult {
  code: string;
  name: string;
  previousTech: TechRating;
  ratingBeforeBreakout: TechRating | null;
  newTech: TechRating | null;
  highBreakout: boolean;
  status: TechUpdateStatus;
  reason: string;
  error: string | null;
}

export interface TechnicalUpdateSummary {
  updatedAt: string;
  successCount: number;
  failedCount: number;
  insufficientDataCount: number;
  boostedCount: number;
  cachedCount: number;
  results: TechnicalUpdateResult[];
}

export interface TechnicalLogEntry {
  updatedAt: string;
  portfolioId: string;
  code: string;
  name: string;
  previousTech: TechRating;
  ratingBeforeBreakout: TechRating | null;
  newTech: TechRating | null;
  highBreakout: boolean;
  status: TechUpdateStatus;
  reason: string;
  error: string | null;
}

// ─── Company name fetch ───────────────────────────────────────────────────────

export interface CompanyNameFetchResult {
  code: string;
  name: string | null;
  source: string;
  error: string | null;
}

export interface CompanyNameFetchResponse {
  results: CompanyNameFetchResult[];
  fetchedAt: string;
}

export interface CompanyNameLogEntry {
  updatedAt: string;
  portfolioId: string;
  code: string;
  previousName: string;
  newName: string | null;
  status: 'success' | 'failed' | 'skipped';
  source: string;
  error: string | null;
}
