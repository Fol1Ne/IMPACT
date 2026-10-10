import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';

/**
 * Remembers which Stripe Checkout Session ids have been VERIFIED as paid (test mode).
 * Persisted to a small JSON file so it survives restarts. No personal data is stored.
 * Pass `null` as filePath for a memory-only store (used in tests).
 */
export class EntitlementStore {
  private ids = new Set<string>();
  constructor(private filePath: string | null) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { sessions?: string[] };
        this.ids = new Set(Array.isArray(data.sessions) ? data.sessions : []);
      } catch {
        log('warn', 'entitlements_file_unreadable');
      }
    }
  }
  has(sessionId: string) { return this.ids.has(sessionId); }
  /** Returns true only the first time a session is granted (idempotent). */
  grant(sessionId: string): boolean {
    if (this.ids.has(sessionId)) return false;
    this.ids.add(sessionId);
    if (this.filePath) {
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify({ sessions: [...this.ids] }, null, 2));
      } catch (err) {
        log('error', 'entitlements_write_failed', { reason: (err as Error).message });
      }
    }
    return true;
  }
}
