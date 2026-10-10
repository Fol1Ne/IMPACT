// Types and pure helpers shared by the client and the server.

export type FeedId = 'significant_week' | '4.5_day' | '4.5_week' | '2.5_day' | '2.5_week' | 'all_day';

export const FEEDS: Record<FeedId, { label: string; coverage: string }> = {
  '4.5_week': { label: 'M4.5+ · past 7 days', coverage: 'Past 7 days, magnitude 4.5 and above' },
  '4.5_day': { label: 'M4.5+ · past 24 hours', coverage: 'Past 24 hours, magnitude 4.5 and above' },
  significant_week: { label: 'Significant · past 7 days', coverage: 'Past 7 days, USGS "significant" events' },
  '2.5_day': { label: 'M2.5+ · past 24 hours', coverage: 'Past 24 hours, magnitude 2.5 and above' },
  '2.5_week': { label: 'M2.5+ · past 7 days', coverage: 'Past 7 days, magnitude 2.5 and above' },
  all_day: { label: 'All events · past 24 hours', coverage: 'Past 24 hours, all magnitudes' },
};
export const DEFAULT_FEED: FeedId = '4.5_week';
export const isFeedId = (v: unknown): v is FeedId => typeof v === 'string' && v in FEEDS;

export interface QuakeEvent {
  id: string;
  title: string;
  magnitude: number | null;
  magType: string | null;
  place: string | null;
  time: number | null; // epoch ms
  updated: number | null; // epoch ms
  longitude: number;
  latitude: number;
  depthKm: number | null;
  url: string | null;
  status: string | null;
  significance: number | null;
  alert: string | null; // USGS PAGER alert level, only when provided
  tsunami: boolean | null; // USGS tsunami flag, only when provided
  felt: number | null; // "Did you feel it?" reports, only when provided
  network: string | null;
}

export interface EventsMeta {
  feed: FeedId;
  feedLabel: string;
  coverage: string;
  source: string;
  sourceUrl: string;
  feedGeneratedAt: number | null;
  fetchedAt: number;
  stale: boolean;
  staleReason?: string;
  count: number;
}
export interface EventsResponse { events: QuakeEvent[]; meta: EventsMeta }

export interface BriefingFact { label: string; value: string }
export interface BriefingSource { label: string; url: string; role: string }
export interface Briefing {
  eventId: string;
  facts: BriefingFact[]; // built from source data, never by the model
  overview: string; // model-written restatement of source facts
  potentialSignificance: string[];
  informationGaps: string[];
  humanitarianConsiderations: string[];
  recommendedInformation: string[];
  sources: BriefingSource[];
  limitations: string[];
}
export interface BriefingResponse {
  briefing: Briefing;
  meta: { provider: 'openrouter'; model: string; generatedAt: number; cached: boolean };
}

export type PaymentState = 'paid' | 'pending' | 'unpaid' | 'expired';
export interface CheckoutStatus { state: PaymentState; entitled: boolean; amount: number | null; currency: string | null; livemode: false }
export interface ProductInfo { id: string; name: string; description: string; priceCents: number; currency: string; includes: string[] }
export interface HealthResponse {
  status: 'ok';
  time: number;
  openrouter: { configured: boolean; model: string };
  stripe: { configured: boolean; testMode: boolean; webhookConfigured: boolean; problem?: string };
  product: ProductInfo;
}

export interface PreparednessPackage {
  eventId: string;
  title: string;
  eventContext: { heading: string; points: string[] };
  sections: { heading: string; items: string[] }[];
  officialLinks: { label: string; url: string }[];
  notice: string;
}

export interface ResourceItem { name: string; why: string; category: string; url: string }
export interface ApiErrorBody { error: { code: string; message: string } }

// ---- pure helpers -------------------------------------------------------

export type MagBand = 'under-4.5' | '4.5-5.9' | '6-plus' | 'unknown';
/** Marker colour rule: based ONLY on USGS magnitude. It is not a measure of humanitarian impact. */
export function magnitudeBand(m: number | null): MagBand {
  if (m === null || Number.isNaN(m)) return 'unknown';
  if (m >= 6) return '6-plus';
  if (m >= 4.5) return '4.5-5.9';
  return 'under-4.5';
}
export const BAND_COLORS: Record<MagBand, string> = {
  'under-4.5': '#22d3ee', '4.5-5.9': '#f59e0b', '6-plus': '#ef4444', unknown: '#8fa0c2',
};

/** USGS magnitude classes (https://www.usgs.gov/programs/earthquake-hazards/earthquake-magnitude-energy-release-and-shaking-intensity). */
export function magnitudeClass(m: number | null): string {
  if (m === null) return 'Magnitude not reported';
  if (m >= 8) return 'Great';
  if (m >= 7) return 'Major';
  if (m >= 6) return 'Strong';
  if (m >= 5) return 'Moderate';
  if (m >= 4) return 'Light';
  if (m >= 3) return 'Minor';
  return 'Micro';
}
export function depthClass(d: number | null): string | null {
  if (d === null) return null;
  if (d < 70) return 'shallow';
  if (d <= 300) return 'intermediate';
  return 'deep';
}

export interface EventFilter { minMagnitude?: number; query?: string }
export type SortKey = 'time' | 'magnitude';

export function filterEvents(events: QuakeEvent[], f: EventFilter): QuakeEvent[] {
  const q = f.query?.trim().toLowerCase() ?? '';
  return events.filter((e) => {
    if (f.minMagnitude !== undefined && f.minMagnitude > 0 && (e.magnitude === null || e.magnitude < f.minMagnitude)) return false;
    if (q && !`${e.place ?? ''} ${e.title}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
export function sortEvents(events: QuakeEvent[], key: SortKey): QuakeEvent[] {
  const copy = [...events];
  if (key === 'magnitude') copy.sort((a, b) => (b.magnitude ?? -Infinity) - (a.magnitude ?? -Infinity));
  else copy.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  return copy;
}
