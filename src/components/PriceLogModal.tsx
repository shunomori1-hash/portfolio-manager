import { useState, useEffect } from 'react';
import type { PriceUpdateLogEntry } from '../types';

interface Props {
  onClose: () => void;
}

function fmt(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('ja-JP');
}

function fmtTs(iso: string): string {
  try { return new Date(iso).toLocaleString('ja-JP'); } catch { return iso; }
}

export function PriceLogModal({ onClose }: Props) {
  const [entries, setEntries] = useState<PriceUpdateLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/prices/log')
      .then(r => r.json())
      .then((data: { entries: PriceUpdateLogEntry[] }) => {
        setEntries(data.entries ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const successCount = entries.filter(e => e.status === 'success').length;
  const failedCount  = entries.filter(e => e.status === 'failed').length;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog price-log-modal">
        <div className="modal-header">
          <h2 className="modal-title">株価更新ログ</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <p style={{ color: '#64748b', fontSize: 13 }}>読み込み中...</p>
          ) : entries.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: 13 }}>ログがありません。株価更新を実行すると記録されます。</p>
          ) : (
            <>
              <div className="import-stats" style={{ marginBottom: 12 }}>
                <div className="stat-item">
                  <span className="stat-label">ログ件数</span>
                  <span className="stat-value">{entries.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">成功</span>
                  <span className="stat-value stat-ok">{successCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">失敗</span>
                  <span className="stat-value stat-warn">{failedCount}</span>
                </div>
              </div>

              <div className="preview-table-wrapper">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>日時</th>
                      <th>コード</th>
                      <th>銘柄名</th>
                      <th>前回株価</th>
                      <th>取得株価</th>
                      <th>変化</th>
                      <th>結果</th>
                      <th>エラー</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => {
                      const change = e.newPrice != null && e.prevPrice != null
                        ? e.newPrice - e.prevPrice : null;
                      const changePct = change != null && e.prevPrice != null && e.prevPrice > 0
                        ? (change / e.prevPrice * 100).toFixed(1) + '%' : null;
                      return (
                        <tr key={i}>
                          <td style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{fmtTs(e.timestamp)}</td>
                          <td>{e.code}</td>
                          <td>{e.name}</td>
                          <td className="num">{fmt(e.prevPrice)}</td>
                          <td className="num">{fmt(e.newPrice)}</td>
                          <td className="num" style={{
                            color: change == null ? undefined : change > 0 ? '#059669' : change < 0 ? '#dc2626' : undefined,
                            fontSize: 11,
                          }}>
                            {change != null ? `${change > 0 ? '+' : ''}${change.toLocaleString('ja-JP')}` : '—'}
                            {changePct && <span style={{ marginLeft: 3, opacity: 0.8 }}>({changePct})</span>}
                          </td>
                          <td>
                            <span className={`log-status log-status-${e.status}`}>
                              {e.status === 'success' ? '✓' : e.status === 'failed' ? '✗' : '–'}
                            </span>
                          </td>
                          <td style={{ fontSize: 10, color: '#dc2626', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.error ?? ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <span className="filter-count">直近{entries.length}件（最大500件）</span>
          <button className="btn btn-secondary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
