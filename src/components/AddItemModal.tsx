import { useState } from 'react';
import type { PortfolioItem } from '../types';

interface Props {
  onAdd: (item: Partial<PortfolioItem>) => void;
  onClose: () => void;
}

export function AddItemModal({ onAdd, onClose }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [shares, setShares] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [settlementMonth, setSettlementMonth] = useState('');
  const [memo, setMemo] = useState('');

  const canSubmit = code.trim() !== '' || name.trim() !== '';

  const toNum = (s: string) => {
    const n = Number(s.replace(/,/g, ''));
    return s.trim() === '' || isNaN(n) ? null : n;
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onAdd({
      code: code.trim(),
      name: name.trim(),
      price: toNum(price),
      shares: toNum(shares),
      targetPrice: toNum(targetPrice),
      settlementMonth,
      memo,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog add-item-modal" onKeyDown={handleKeyDown}>
        <div className="modal-header">
          <h2 className="modal-title">銘柄追加</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="add-item-form">
            <div className="form-row">
              <label className="form-label">コード <span className="form-required">*</span></label>
              <input
                className="form-input"
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="例: 7203"
                autoFocus
              />
            </div>
            <div className="form-row">
              <label className="form-label">銘柄名</label>
              <input
                className="form-input"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="例: トヨタ自動車"
              />
            </div>
            <div className="form-row">
              <label className="form-label">株価</label>
              <input
                className="form-input"
                type="text"
                inputMode="numeric"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="例: 2055"
              />
            </div>
            <div className="form-row">
              <label className="form-label">株数</label>
              <input
                className="form-input"
                type="text"
                inputMode="numeric"
                value={shares}
                onChange={e => setShares(e.target.value)}
                placeholder="例: 100"
              />
            </div>
            <div className="form-row">
              <label className="form-label">目標株価</label>
              <input
                className="form-input"
                type="text"
                inputMode="numeric"
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                placeholder="例: 3000"
              />
            </div>
            <div className="form-row">
              <label className="form-label">決算月</label>
              <input
                className="form-input"
                type="text"
                value={settlementMonth}
                onChange={e => setSettlementMonth(e.target.value)}
                placeholder="例: 3月"
              />
            </div>
            <div className="form-row">
              <label className="form-label">メモ</label>
              <input
                className="form-input"
                type="text"
                value={memo}
                onChange={e => setMemo(e.target.value)}
                placeholder="自由記述"
              />
            </div>
          </div>
          <p className="form-hint">Ctrl+Enter で追加</p>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>キャンセル</button>
          <button className="btn btn-save" onClick={handleSubmit} disabled={!canSubmit}>
            追加
          </button>
        </div>
      </div>
    </div>
  );
}
