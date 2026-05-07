import type { PortfolioItem, TagValue, FxValue, PeriodValue } from '../types';

export type ImportMode = 'replace' | 'merge';

export interface CsvColumnMapping {
  csvHeader: string;
  appField: keyof PortfolioItem | 'skip' | 'calc';
}

export interface CsvParseResult {
  items: PortfolioItem[];
  mappings: CsvColumnMapping[];
  warnings: string[];
  skippedRows: string[];
  totalRows: number;
}

// Normalize header string for matching (remove whitespace, full-width chars)
function normalizeHeader(h: string): string {
  return h.trim().replace(/[\s　]/g, '');
}

// CSV header → PortfolioItem field (or 'skip' / 'calc')
const HEADER_MAP: Record<string, keyof PortfolioItem | 'skip' | 'calc'> = {
  'コード': 'code',
  '銘柄コード': 'code',
  'コード番号': 'code',
  '銘柄名': 'name',
  '株価': 'price',
  '現在株価': 'price',
  '株数': 'shares',
  '保有株数': 'shares',
  '保有金額': 'calc',
  '時価': 'calc',
  '割合': 'calc',
  '比率': 'calc',
  '予定株数': 'plannedShares',
  '増減予定株数': 'plannedShares',  // mapped to plannedShares (final target count)
  '増減後金額': 'calc',
  '増減後割合': 'calc',
  '増減後比率': 'calc',
  '予定後金額': 'calc',
  '予定後割合': 'calc',
  '決算': 'settlementMonth',
  '決算月': 'settlementMonth',
  'テク': 'tech',
  'テクノロジー': 'tech',
  'TOPIX': 'topix',
  'Topix': 'topix',
  'topix': 'topix',
  'ボーダー': 'borderPrice',
  'ボーダー株価': 'borderPrice',
  '下値目処': 'borderPrice',
  '乖離': 'calc',
  '乖離率': 'calc',
  '目標株価': 'targetPrice',
  '目標期間': 'targetPeriod',
  '上値余地': 'calc',
  '為替': 'fx',
  'インフレ': 'inflation',
  'IR': 'ir',
  'ir': 'ir',
  'PER': 'per',
  'Per': 'per',
  'per': 'per',
  'pera': 'skip',
  'PERA': 'skip',
  '経営者': 'management',
  '競争力': 'competitiveness',
  'ガバ': 'governance',
  'ガバナンス': 'governance',
  'ネットC': 'netCash',
  'ネットキャッシュ': 'netCash',
  'ネットPER': 'skip',
  '3月配当': 'marchDividend',
  '配当': 'dividend',
  '配当金': 'calc',
  '配当利回': 'calc',
  '配当利回り': 'calc',
  '優待': 'benefit',
  '株主優待': 'benefit',
  '優待利回': 'calc',
  '優待利回り': 'calc',
  'メモ': 'memo',
  '備考': 'memo',
  'タグ': 'tag',
};

const TAG_FIELDS = new Set<keyof PortfolioItem>([
  'tech', 'topix', 'inflation', 'ir', 'management', 'competitiveness', 'governance', 'tag',
]);
const TAG_VALUES = new Set(['◎', '○', '△', '×', '']);

const FX_FIELDS = new Set<keyof PortfolioItem>(['fx']);
const PERIOD_FIELDS = new Set<keyof PortfolioItem>(['targetPeriod']);
const PERIOD_VALUES = new Set(['3ヶ月', '半年', '1年', '2年', '']);
const NUMERIC_FIELDS = new Set<keyof PortfolioItem>([
  'price', 'shares', 'plannedShares', 'plannedDelta', 'borderPrice', 'targetPrice',
  'per', 'netCash', 'marchDividend', 'dividend', 'benefit',
]);

async function readFileWithEncoding(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // UTF-8 BOM (EF BB BF)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    const text = new TextDecoder('utf-8').decode(buffer);
    return text.slice(1); // remove BOM character
  }

  // Try strict UTF-8; fall back to Shift-JIS (common for Japanese Excel exports)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift-jis').decode(buffer);
  }
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let i = 0;

  while (i <= src.length) {
    const row: string[] = [];
    let rowEmpty = true;

    while (i <= src.length) {
      if (i === src.length || src[i] === '\n') {
        // end of line — push empty field only if row already has fields
        if (row.length > 0 || !rowEmpty) row.push('');
        i++;
        break;
      }

      if (src[i] === '"') {
        rowEmpty = false;
        let field = '';
        i++; // skip opening quote
        while (i < src.length) {
          if (src[i] === '"') {
            if (src[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            field += src[i++];
          }
        }
        row.push(field);
        if (i < src.length && src[i] === ',') i++;
      } else {
        rowEmpty = false;
        let field = '';
        while (i < src.length && src[i] !== ',' && src[i] !== '\n') {
          field += src[i++];
        }
        row.push(field.trim());
        if (i < src.length && src[i] === ',') i++;
      }
    }

    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeNumber(value: string): number | null {
  if (!value || value.trim() === '' || value.trim() === '-') return null;
  const v = value.trim()
    .replace(/[¥￥,]/g, '')  // strip currency symbols and commas
    .replace(/%$/, '');       // strip trailing %
  const num = parseFloat(v);
  return isNaN(num) ? null : num;
}

function normalizeTagValue(value: string): TagValue {
  const v = value.trim();
  return TAG_VALUES.has(v) ? (v as TagValue) : '';
}

function normalizeFxValue(value: string): FxValue {
  const v = value.trim();
  return v === '円高' || v === '円安' ? v : '';
}

function normalizePeriodValue(value: string): PeriodValue {
  const v = value.trim();
  if (PERIOD_VALUES.has(v)) return v as PeriodValue;
  // Handle common variations
  if (/^3[ヶかカヵ]月$/.test(v)) return '3ヶ月';
  if (/^(半年|6[ヶかカヵ]月)$/.test(v)) return '半年';
  if (/^1年$/.test(v)) return '1年';
  if (/^2年$/.test(v)) return '2年';
  return '';
}

// Returns true if the value looks like a Japanese word (likely a summary/total row)
function looksLikeJapaneseWord(s: string): boolean {
  return /[぀-ゟ゠-ヿ一-龯]/.test(s);
}

export async function parseCsvFile(file: File): Promise<CsvParseResult> {
  const warnings: string[] = [];
  const skippedRows: string[] = [];

  let text: string;
  try {
    text = await readFileWithEncoding(file);
  } catch (e) {
    throw new Error('CSVファイルの読み込みに失敗しました: ' + String(e instanceof Error ? e.message : e));
  }

  const rows = parseCsvText(text);
  if (rows.length === 0) {
    throw new Error('CSVファイルが空です');
  }

  const headerRow = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1);

  // Build column mappings
  const mappings: CsvColumnMapping[] = headerRow.map(h => {
    const normalized = normalizeHeader(h);
    const field = HEADER_MAP[normalized] ?? HEADER_MAP[h] ?? 'skip';
    return { csvHeader: h, appField: field };
  });

  const codeIdx = mappings.findIndex(m => m.appField === 'code');
  const nameIdx = mappings.findIndex(m => m.appField === 'name');

  if (codeIdx === -1) {
    throw new Error('コード列が見つかりません。CSVに「コード」または「銘柄コード」列が必要です');
  }
  if (nameIdx === -1) {
    throw new Error('銘柄名列が見つかりません。CSVに「銘柄名」列が必要です');
  }

  const items: PortfolioItem[] = [];
  const seenCodes = new Set<string>();
  const totalRows = dataRows.length;

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx];
    const code = row[codeIdx]?.trim() ?? '';
    const name = row[nameIdx]?.trim() ?? '';

    // Skip completely empty rows
    if (!code && !name) continue;

    // Skip summary/total rows (code contains Japanese)
    if (code && looksLikeJapaneseWord(code)) {
      skippedRows.push(`行${rowIdx + 2}: 「${code}」はコードとして認識できません — スキップ`);
      continue;
    }

    if (!code) {
      skippedRows.push(`行${rowIdx + 2}: コードが空 (銘柄名: ${name || '(空)'}) — スキップ`);
      continue;
    }

    if (seenCodes.has(code)) {
      warnings.push(`コード ${code} が複数行存在します。後の行が優先されます`);
    }
    seenCodes.add(code);

    const item: PortfolioItem = {
      id: crypto.randomUUID(),
      code: String(code),
      name,
      price: null,
      shares: null,
      plannedShares: null,
      plannedDelta: null,
      settlementMonth: '',
      tech: '',
      topix: '',
      borderPrice: null,
      targetPrice: null,
      targetPeriod: '',
      fx: '',
      inflation: '',
      ir: '',
      per: null,
      management: '',
      competitiveness: '',
      governance: '',
      netCash: null,
      marchDividend: null,
      dividend: null,
      benefit: null,
      memo: '',
      tag: '',
      priceUpdatedAt: null,
      priceError: null,
      priceUpdateStatus: 'unknown',
      previousPrice: null,
      fiscalMonthUpdateStatus: 'unknown',
      fiscalMonthUpdateError: null,
      lastFiscalMonthUpdatedAt: null,
      techAutoRating: '',
      techRatingBeforeBreakout: null,
      techBreakoutBoosted: false,
      techReason: '',
      techUpdatedAt: null,
      techUpdateStatus: 'unknown',
      techUpdateError: null,
      nameUpdateStatus: 'unknown',
      nameUpdateError: null,
      nameUpdatedAt: null,
    };

    for (let colIdx = 0; colIdx < mappings.length; colIdx++) {
      const { appField } = mappings[colIdx];
      if (appField === 'skip' || appField === 'calc' || appField === 'code' || appField === 'name') continue;

      const rawValue = row[colIdx]?.trim() ?? '';
      const field = appField as keyof PortfolioItem;

      if (NUMERIC_FIELDS.has(field)) {
        (item as unknown as Record<string, unknown>)[field] = normalizeNumber(rawValue);
      } else if (TAG_FIELDS.has(field)) {
        (item as unknown as Record<string, unknown>)[field] = normalizeTagValue(rawValue);
      } else if (FX_FIELDS.has(field)) {
        (item as unknown as Record<string, unknown>)[field] = normalizeFxValue(rawValue);
      } else if (PERIOD_FIELDS.has(field)) {
        (item as unknown as Record<string, unknown>)[field] = normalizePeriodValue(rawValue);
      } else {
        // string fields: settlementMonth, memo
        (item as unknown as Record<string, unknown>)[field] = rawValue;
      }
    }

    items.push(item);
  }

  if (items.length === 0) {
    throw new Error('有効な銘柄行が1件もありません');
  }

  return { items, mappings, warnings, skippedRows, totalRows };
}

export function applyImport(
  existing: PortfolioItem[],
  imported: PortfolioItem[],
  mode: ImportMode,
): PortfolioItem[] {
  if (mode === 'replace') {
    return imported;
  }

  // merge: update by code match, add new, keep unmatched existing
  const importedMap = new Map(imported.map(item => [item.code, item]));
  const result: PortfolioItem[] = [];

  for (const existingItem of existing) {
    const incoming = importedMap.get(existingItem.code);
    if (incoming) {
      result.push({
        ...existingItem,
        ...incoming,
        id: existingItem.id,
        priceUpdatedAt: existingItem.priceUpdatedAt,
        priceError: existingItem.priceError,
      });
    } else {
      result.push(existingItem);
    }
  }

  // Append new items (in CSV but not in existing)
  const existingCodes = new Set(existing.map(i => i.code));
  for (const importedItem of imported) {
    if (!existingCodes.has(importedItem.code)) {
      result.push(importedItem);
    }
  }

  return result;
}

// Human-readable label for an appField
export const APP_FIELD_LABELS: Record<string, string> = {
  code: 'コード',
  name: '銘柄名',
  price: '株価',
  shares: '株数',
  plannedShares: '予定株数',
  plannedDelta: '増減予定株数',
  settlementMonth: '決算月',
  tech: 'テク',
  topix: 'TOPIX',
  borderPrice: 'ボーダー',
  targetPrice: '目標株価',
  targetPeriod: '目標期間',
  fx: '為替',
  inflation: 'インフレ',
  ir: 'IR',
  per: 'PER',
  management: '経営者',
  competitiveness: '競争力',
  governance: 'ガバナンス',
  netCash: 'ネットC',
  marchDividend: '3月配当',
  dividend: '配当',
  benefit: '優待',
  memo: 'メモ',
  tag: 'タグ',
  calc: '自動計算',
  skip: 'スキップ',
};
