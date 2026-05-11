import type { Portfolio } from '../types';

// ── localStorage keys ──────────────────────────────────────────────────────
const LS_PREFIX = 'portfolio-manager-unsaved-backup';

export function lsBackupKey(portfolioId: string): string {
  return `${LS_PREFIX}-${portfolioId}`;
}

// ── Backup entry ───────────────────────────────────────────────────────────
export interface BackupEntry {
  portfolioId: string;
  data: Portfolio;
  savedAt: string;
  reason: 'save_failed_api_offline' | 'auto_dirty';
}

// ── Write ──────────────────────────────────────────────────────────────────
export function saveBackup(
  portfolioId: string,
  portfolio: Portfolio,
  reason: BackupEntry['reason'],
): void {
  try {
    const entry: BackupEntry = {
      portfolioId,
      data: portfolio,
      savedAt: new Date().toISOString(),
      reason,
    };
    localStorage.setItem(lsBackupKey(portfolioId), JSON.stringify(entry));
  } catch { /* ignore quota / private-browsing errors */ }
}

// ── Read ───────────────────────────────────────────────────────────────────
export function loadBackup(portfolioId: string): BackupEntry | null {
  try {
    const raw = localStorage.getItem(lsBackupKey(portfolioId));
    if (!raw) return null;
    return JSON.parse(raw) as BackupEntry;
  } catch {
    return null;
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────
export function clearBackup(portfolioId: string): void {
  try {
    localStorage.removeItem(lsBackupKey(portfolioId));
  } catch { /* ignore */ }
}
