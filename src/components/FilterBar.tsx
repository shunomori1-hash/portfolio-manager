import type { FilterState } from '../utils/tableState';

interface Props {
  filter: FilterState;
  onChange: (updates: Partial<FilterState>) => void;
  onClear: () => void;
  active: boolean;
  totalCount: number;
  filteredCount: number;
}

const TAG_OPTS = ['◎', '○', '△', '×'];
const FX_OPTS = ['円高', '円安'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

export function FilterBar({ filter, onChange, onClear, active, totalCount, filteredCount }: Props) {
  return (
    <div className="filter-bar">
      <div className="filter-row">
        <input
          type="text"
          className="filter-search"
          placeholder="コード・銘柄名..."
          value={filter.search}
          onChange={e => onChange({ search: e.target.value })}
        />

        <select className="filter-select" value={filter.settlementMonth}
          onChange={e => onChange({ settlementMonth: e.target.value })}>
          <option value="">決算: 全て</option>
          {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <select className="filter-select filter-select-sm" value={filter.tech}
          onChange={e => onChange({ tech: e.target.value })}>
          <option value="">テク</option>
          {TAG_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <select className="filter-select filter-select-sm" value={filter.topix}
          onChange={e => onChange({ topix: e.target.value })}>
          <option value="">TOPIX</option>
          {TAG_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <select className="filter-select filter-select-sm" value={filter.fx}
          onChange={e => onChange({ fx: e.target.value })}>
          <option value="">為替</option>
          {FX_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <select className="filter-select filter-select-sm" value={filter.ir}
          onChange={e => onChange({ ir: e.target.value })}>
          <option value="">IR</option>
          {TAG_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <select className="filter-select filter-select-sm" value={filter.management}
          onChange={e => onChange({ management: e.target.value })}>
          <option value="">経営者</option>
          {TAG_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <label className="filter-check">
          <input type="checkbox" checked={filter.upsideOnly}
            onChange={e => onChange({ upsideOnly: e.target.checked })} />
          上値余地+
        </label>

        <label className="filter-check">
          <input type="checkbox" checked={filter.dividendOnly}
            onChange={e => onChange({ dividendOnly: e.target.checked })} />
          配当あり
        </label>

        <label className="filter-check" title="予定株数が現在株数と異なる銘柄のみ表示">
          <input type="checkbox" checked={filter.plannedChangeOnly}
            onChange={e => onChange({ plannedChangeOnly: e.target.checked })} />
          予定変更あり
        </label>

        {active && (
          <button className="btn btn-filter-clear" onClick={onClear}>
            解除
          </button>
        )}

        <span className="filter-count">
          {active ? `${filteredCount} / ${totalCount}件` : `${totalCount}件`}
        </span>
      </div>
    </div>
  );
}
