import { useState } from 'react';
import { ALL_COLS, COL_PRESETS, type ColKey, type PresetName } from '../utils/tableState';

interface Props {
  visible: Set<ColKey>;
  onApply: (visible: Set<ColKey>) => void;
  onClose: () => void;
}

const PRESET_LABELS: Record<PresetName, string> = {
  basic: '基本',
  investment: '投資判断',
  dividend: '配当',
  all: '全列',
};

export function ColumnSettingsModal({ visible, onApply, onClose }: Props) {
  const [current, setCurrent] = useState<Set<ColKey>>(new Set(visible));

  const toggle = (key: ColKey) => {
    if (key === 'code' || key === 'name') return; // always visible
    setCurrent(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog col-settings-modal">
        <div className="modal-header">
          <h2 className="modal-title">列設定</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="preset-btns">
            <span className="preset-label">プリセット:</span>
            {(Object.keys(PRESET_LABELS) as PresetName[]).map(p => (
              <button
                key={p}
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => setCurrent(new Set(COL_PRESETS[p]))}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
          </div>

          <div className="col-check-grid">
            {ALL_COLS.map(col => {
              const locked = col.key === 'code' || col.key === 'name';
              return (
                <label key={col.key} className={`col-check-item${locked ? ' col-locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={current.has(col.key)}
                    onChange={() => toggle(col.key)}
                    disabled={locked}
                  />
                  {col.label}
                </label>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <span className="filter-count">{current.size}列選択中</span>
          <button className="btn btn-secondary" onClick={onClose}>キャンセル</button>
          <button className="btn btn-save" onClick={() => { onApply(current); onClose(); }}>
            適用
          </button>
        </div>
      </div>
    </div>
  );
}
