import { useState, useEffect, useRef } from 'react';

// Checks /api/health every CHECK_INTERVAL ms.
// Tracks online/offline transitions so the UI can show reconnect notices.
const CHECK_INTERVAL = 45_000; // 45 s — light enough, catches outages within a minute
const TIMEOUT_MS     = 5_000;  // abort if no response in 5 s

export type ApiStatus = 'online' | 'offline' | 'unknown';

export interface UseApiHealthResult {
  apiStatus: ApiStatus;
  justReconnected: boolean;          // true for one cycle after offline→online
  acknowledgeReconnect: () => void;  // call to clear justReconnected
}

export function useApiHealth(): UseApiHealthResult {
  const [apiStatus, setApiStatus]           = useState<ApiStatus>('unknown');
  const [justReconnected, setJustReconnected] = useState(false);
  const prevOnline = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      let online = false;
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const r = await fetch('/api/health', { signal: controller.signal });
        clearTimeout(tid);
        const ct = r.headers.get('content-type') ?? '';
        online = r.ok && ct.includes('application/json');
      } catch {
        online = false;
      }

      if (cancelled) return;

      setApiStatus(online ? 'online' : 'offline');

      // Detect offline→online transition
      if (prevOnline.current === false && online) {
        setJustReconnected(true);
      }
      prevOnline.current = online;
    };

    check();
    const id = setInterval(check, CHECK_INTERVAL);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const acknowledgeReconnect = () => setJustReconnected(false);

  return { apiStatus, justReconnected, acknowledgeReconnect };
}
