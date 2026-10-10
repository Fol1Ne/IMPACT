import fs from 'node:fs';
import path from 'node:path';
import type { DonationStatus } from '../../../shared/types';
import { log } from '../logger';

const MAX_RECORDS = 2000;

/**
 * Donation status keyed by PaymentIntent id. Holds amounts, states and Stripe object ids only:
 * no card details, names or emails. Pass `null` as filePath for a memory-only store.
 */
export class DonationStore {
  private map = new Map<string, DonationStatus>();
  private chargeToPi = new Map<string, string>();
  constructor(private filePath: string | null) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { donations?: (DonationStatus & { chargeId?: string })[] };
        for (const d of data.donations ?? []) { this.map.set(d.id, d); if (d.chargeId) this.chargeToPi.set(d.chargeId, d.id); }
      } catch {
        log('warn', 'donations_file_unreadable');
      }
    }
  }
  get(id: string) { return this.map.get(id); }
  byCharge(chargeId: string) { const id = this.chargeToPi.get(chargeId); return id ? this.map.get(id) : undefined; }
  upsert(d: DonationStatus, chargeId?: string | null) {
    this.map.set(d.id, d);
    if (chargeId) this.chargeToPi.set(chargeId, d.id);
    while (this.map.size > MAX_RECORDS) this.map.delete(this.map.keys().next().value!);
    this.persist();
  }
  private persist() {
    if (!this.filePath) return;
    try {
      const charges = new Map([...this.chargeToPi].map(([c, p]) => [p, c]));
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ donations: [...this.map.values()].map((d) => ({ ...d, chargeId: charges.get(d.id) })) }, null, 2));
    } catch (err) {
      log('error', 'donations_write_failed', { reason: (err as Error).message });
    }
  }
}
