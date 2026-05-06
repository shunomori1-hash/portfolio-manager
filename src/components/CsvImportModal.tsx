import { useState, useRef } from 'react';
import type { PortfolioItem } from '../types';
import {
  parseCsvFile,
  applyImport,
  APP_FIELD_LABELS,
  type ImportMode,
  type CsvParseResult,
} from '../utils/csvImport';

interface Props {
  existingItems: PortfolioItem[];
  onImport: (items: PortfolioItem[]) => Promise<void>;
  onClose: () => void;
}

export function CsvImportModal({ existingItems, onImport, onClose }: Props) {
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so same file can be re-selected later
    e.target.value = '';
    if (!file) return;

    setParseError(null);
    setParseResult(null);
    setFileName(file.name);

    try {
      const result = await parseCsvFile(file);
      setParseResult(result);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImport = async () => {
    if (!parseResult) return;
    setImporting(true);
    try {
      const finalItems = applyImport(existingItems, parseResult.items, importMode);
      await onImport(finalItems);
      onClose();
    } catch (err) {
      setParseError('インポートに失敗しました: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImporting(false);
    }
  };

  const mappedCount = parseResult
    ? parseResult.mappings.filter(m => m.appField !== 'skip' && m.appField !== 'calc').length
    : 0;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog csv-import-modal">
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">CSVインポート</h2>
          <button className="modal-close" onClick={onClose} title="閉じる">✕</button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* File selector */}
          <div className="import-section">
            <div className="import-section-label">CSVファイルを選択</div>
            <div className="file-select-row">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                ファイルを選択
              </button>
              {fileName && <span className="file-name">{fileName}</span>}
              <span className="import-note">UTF-8 / Shift-JIS（Excel形式）対応</span>
            </div>
          </div>

          {/* Parse error */}
          {parseError && (
            <div className="import-error">
              <strong>エラー:</strong> {parseError}
            </div>
          )}

          {/* Preview section */}
          {parseResult && (
            <>
              {/* Stats */}
              <div className="import-stats">
                <div className="stat-item">
                  <span className="stat-label">読み取り行数</span>
                  <span className="stat-value">{parseResult.totalRows}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">認識した銘柄</span>
                  <span className="stat-value stat-ok">{parseResult.items.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">マッピング列数</span>
                  <span className="stat-value">{mappedCount}</span>
                </div>
                {parseResult.skippedRows.length > 0 && (
                  <div className="stat-item">
                    <span className="stat-label">スキップ行</span>
                    <span className="stat-value stat-warn">{parseResult.skippedRows.length}</span>
                  </div>
                )}
              </div>

              {/* Column mapping */}
              <div className="import-section">
                <div className="import-section-label">列マッピング</div>
                <div className="mapping-grid">
                  {parseResult.mappings.map((m, i) => (
                    <div
                      key={i}
                      className={`mapping-item ${
                        m.appField === 'skip' ? 'mapping-skip' :
                        m.appField === 'calc' ? 'mapping-calc' :
                        'mapping-ok'
                      }`}
                    >
                      <span className="mapping-csv">{m.csvHeader || '(空)'}</span>
                      <span className="mapping-arrow">→</span>
                      <span className="mapping-app">
                        {APP_FIELD_LABELS[m.appField as string] ?? m.appField}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Warnings */}
              {(parseResult.warnings.length > 0 || parseResult.skippedRows.length > 0) && (
                <div className="import-section">
                  <div className="import-section-label">警告 / スキップ行</div>
                  <ul className="warning-list">
                    {parseResult.warnings.map((w, i) => (
                      <li key={`w-${i}`} className="warning-item">{w}</li>
                    ))}
                    {parseResult.skippedRows.map((r, i) => (
                      <li key={`s-${i}`} className="warning-item warning-skip">{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Import mode */}
              <div className="import-section">
                <div className="import-section-label">インポート方式</div>
                <div className="import-mode-group">
                  <label className="import-mode-option">
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                    />
                    <div className="import-mode-text">
                      <strong>コード一致で更新（推奨）</strong>
                      <p>コードが一致する銘柄を更新。CSVにない既存銘柄は残す。新規銘柄は追加。</p>
                    </div>
                  </label>
                  <label className="import-mode-option">
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                    />
                    <div className="import-mode-text">
                      <strong>全置換</strong>
                      <p>現在のデータをCSV内容で完全に置き換えます。バックアップは自動作成されます。</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Preview table */}
              <div className="import-section">
                <div className="import-section-label">
                  プレビュー（先頭{Math.min(parseResult.items.length, 10)}件）
                </div>
                <div className="preview-table-wrapper">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th>コード</th>
                        <th>銘柄名</th>
                        <th>株価</th>
                        <th>株数</th>
                        <th>目標株価</th>
                        <th>決算月</th>
                        <th>テク</th>
                        <th>ボーダー</th>
                        <th>メモ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseResult.items.slice(0, 10).map((item, i) => (
                        <tr key={i}>
                          <td>{item.code}</td>
                          <td>{item.name}</td>
                          <td className="num">{item.price ?? ''}</td>
                          <td className="num">{item.shares ?? ''}</td>
                          <td className="num">{item.targetPrice ?? ''}</td>
                          <td>{item.settlementMonth}</td>
                          <td style={{ textAlign: 'center' }}>{item.tech}</td>
                          <td className="num">{item.borderPrice ?? ''}</td>
                          <td>{item.memo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          {parseResult && (
            <button
              className="btn btn-save"
              onClick={handleImport}
              disabled={importing}
            >
              {importing
                ? 'インポート中...'
                : `この内容でインポート（${parseResult.items.length}件）`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
