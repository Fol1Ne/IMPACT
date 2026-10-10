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
  twilio: { configured: boolean };
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

export interface NewsItem {
  id: string;
  headline: string;
  sourceName: string;
  publishedAt: number; // epoch ms, publisher timestamp from the feed
  url: string;
  /** Whether the headline itself names the country, as opposed to a looser keyword hit. */
  headlineMatch: boolean;
}
export interface NewsResponse {
  country: string; // ISO 3166-1 alpha-2
  countryName: string;
  items: NewsItem[];
  meta: { source: string; scopeNote: string; fetchedAt: number; stale: boolean; staleReason?: string };
}
export interface ApiErrorBody { error: { code: string; message: string } }

// ---- unified hazard model ----------------------------------------------

export type HazardCategory =
  | 'earthquakes' | 'wildfires' | 'volcanoes' | 'floods' | 'severeStorms' | 'drought' | 'seaLakeIce'
  | 'landslides' | 'dustHaze' | 'snow' | 'tempExtremes' | 'waterColor' | 'manmade' | 'conflict';

/** Accent colours are restrained; earthquakes keep the magnitude-band colours. Never the only cue: lists and tooltips name the category. */
export const CATEGORIES: Record<HazardCategory, { label: string; color: string }> = {
  earthquakes: { label: 'Earthquakes', color: '#22d3ee' },
  wildfires: { label: 'Wildfires', color: '#f472b6' },
  volcanoes: { label: 'Volcanoes', color: '#c084fc' },
  floods: { label: 'Floods', color: '#3b82f6' },
  severeStorms: { label: 'Severe storms', color: '#a3e635' },
  drought: { label: 'Drought', color: '#d4a373' },
  seaLakeIce: { label: 'Sea and lake ice', color: '#e5e7eb' },
  landslides: { label: 'Landslides', color: '#a8a29e' },
  dustHaze: { label: 'Dust and haze', color: '#94a3b8' },
  snow: { label: 'Snow', color: '#cbd5e1' },
  tempExtremes: { label: 'Temperature extremes', color: '#fda4af' },
  waterColor: { label: 'Water colour', color: '#5eead4' },
  manmade: { label: 'Manmade', color: '#94a3b8' },
  conflict: { label: 'Armed conflict', color: '#f43f5e' },
};
export const isHazardCategory = (v: unknown): v is HazardCategory => typeof v === 'string' && v in CATEGORIES;

export type Provider = 'usgs' | 'eonet' | 'acled' | 'ucdp';
export const PROVIDERS: Record<Provider, { label: string; url: string }> = {
  usgs: { label: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/' },
  eonet: { label: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/' },
  acled: { label: 'ACLED', url: 'https://acleddata.com/' },
  ucdp: { label: 'UCDP Candidate', url: 'https://ucdp.uu.se/' },
};
export const isProvider = (v: unknown): v is Provider => typeof v === 'string' && v in PROVIDERS;
export const CONFLICT_PROVIDERS: readonly Provider[] = ['acled', 'ucdp'];

/** Fields carried over from ACLED or UCDP rows; nothing here is derived or estimated by IMPACT. */
export interface ConflictDetails {
  eventType: string; // ACLED event_type, or the UCDP type_of_violence label
  subEventType: string | null; // ACLED sub_event_type, or the UCDP conflict_name
  actors: string[];
  fatalities: number | null; // ACLED fatalities, or UCDP "best" estimate
  country: string | null;
  admin1: string | null;
  /** Plain-language note on how exact the location is, from the provider's precision code. */
  locationPrecision: string | null;
  /** True when the event is classed as fighting between armed groups (ACLED "Battles", UCDP state-based or non-state). */
  battle: boolean;
}

export interface HazardSource {
  provider: Provider;
  providerId: string; // raw id at the provider, kept for traceability
  url: string | null;
  label: string;
  /** For EONET: the upstream source EONET cites (GDACS, IRWIN, JTWC...). */
  origin?: string;
}

export interface HazardEvent {
  id: string; // stable internal id: "usgs:<id>" or "eonet:<id>"
  title: string;
  category: HazardCategory;
  latitude: number; // representative point: latest reported position, or polygon centre
  longitude: number;
  geometryType: 'point' | 'track' | 'polygon';
  track: [number, number][]; // earlier [lng, lat] positions (storm tracks), bounded
  startTime: number | null; // epoch ms, UTC
  updatedTime: number | null;
  closedTime: number | null;
  severity: { value: number; unit: string; provider: Provider } | null;
  place: string | null;
  description: string | null;
  sources: HazardSource[];
  /** Present when a USGS record is part of this event; drives the earthquake-specific panels. */
  quake: QuakeEvent | null;
  match: { method: 'identifier' | 'proximity'; note: string } | null;
  /** Present on armed-conflict events (ACLED or UCDP). */
  conflict?: ConflictDetails;
}

export type RangePreset = '24h' | '7d' | '30d' | '90d' | '365d';
export const RANGE_PRESETS: Record<RangePreset, { label: string; days: number }> = {
  '24h': { label: 'Last 24 hours', days: 1 },
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
  '365d': { label: 'Last year (rolling 365 days)', days: 365 },
};
export const isRangePreset = (v: unknown): v is RangePreset => typeof v === 'string' && v in RANGE_PRESETS;
export const MAX_RANGE_DAYS = 366;
/** USGS caps one query at 20,000 events; a year at M2.5+ exceeds that, so long ranges need M4.5+. */
export const LONG_RANGE_DAYS = 31;
export const LONG_RANGE_MIN_MAGNITUDE = 4.5;
export const SHORT_RANGE_MIN_MAGNITUDE = 2.5;

export interface TimeRange { start: number; end: number; preset: RangePreset | 'custom'; label: string }

export interface ProviderStatus {
  provider: Provider;
  ok: boolean;
  stale: boolean;
  partial: boolean;
  fetchedAt: number | null;
  count: number;
  error?: string;
  notes: string[];
}

export interface HazardsResponse {
  events: HazardEvent[];
  meta: {
    range: TimeRange; minMagnitude: number; providers: ProviderStatus[]; merged: number; limitations: string[];
    /** Which armed-conflict source the server has credentials for; null when none is configured. */
    conflictSource: 'acled' | 'ucdp' | null;
  };
}

const DAY_MS = 86_400_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve a preset or a custom YYYY-MM-DD pair (UTC, end date inclusive). Throws on invalid input. */
export function resolveRange(input: { preset?: string; start?: string; end?: string }, now = Date.now()): TimeRange {
  if (input.start || input.end) {
    if (!input.start || !input.end || !isoDay.test(input.start) || !isoDay.test(input.end)) throw new RangeError('Custom ranges need start and end dates as YYYY-MM-DD.');
    const start = Date.parse(`${input.start}T00:00:00Z`);
    const end = Math.min(Date.parse(`${input.end}T00:00:00Z`) + DAY_MS - 1, now);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new RangeError('The start date must be on or before the end date, and not in the future.');
    if (end - start > MAX_RANGE_DAYS * DAY_MS) throw new RangeError(`Custom ranges are limited to ${MAX_RANGE_DAYS} days.`);
    return { start, end, preset: 'custom', label: `${input.start} to ${input.end} (UTC)` };
  }
  const preset = input.preset ?? '7d';
  if (!isRangePreset(preset)) throw new RangeError('Unknown range preset.');
  return { start: now - RANGE_PRESETS[preset].days * DAY_MS, end: now, preset, label: RANGE_PRESETS[preset].label };
}

export const rangeDays = (r: Pick<TimeRange, 'start' | 'end'>) => (r.end - r.start) / DAY_MS;
export const minMagnitudeFloor = (r: Pick<TimeRange, 'start' | 'end'>) => (rangeDays(r) > LONG_RANGE_DAYS ? LONG_RANGE_MIN_MAGNITUDE : SHORT_RANGE_MIN_MAGNITUDE);

export interface HazardFilter { categories?: HazardCategory[]; providers?: Provider[]; minMagnitude?: number; query?: string }

export function filterHazards(events: HazardEvent[], f: HazardFilter): HazardEvent[] {
  const q = f.query?.trim().toLowerCase() ?? '';
  const cats = f.categories ? new Set(f.categories) : null;
  const provs = f.providers ? new Set(f.providers) : null;
  return events.filter((e) => {
    if (cats && !cats.has(e.category)) return false;
    if (provs && !e.sources.some((s) => provs.has(s.provider))) return false;
    if (e.category === 'earthquakes' && f.minMagnitude && f.minMagnitude > 0 && (e.severity === null || e.severity.value < f.minMagnitude)) return false;
    if (q && !`${e.title} ${e.place ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export type HazardSort = 'time' | 'severity';
export function sortHazards(events: HazardEvent[], key: HazardSort): HazardEvent[] {
  const copy = [...events];
  if (key === 'severity') copy.sort((a, b) => (b.category === 'earthquakes' ? (b.severity?.value ?? -1) : -1) - (a.category === 'earthquakes' ? (a.severity?.value ?? -1) : -1) || (b.updatedTime ?? 0) - (a.updatedTime ?? 0));
  else copy.sort((a, b) => (b.updatedTime ?? b.startTime ?? 0) - (a.updatedTime ?? a.startTime ?? 0));
  return copy;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Short human label for a severity value, e.g. "M 6.1", "35 kts", "17,663 ha". */
export function severityLabel(s: HazardEvent['severity']): string | null {
  if (!s) return null;
  const unit = s.unit.toLowerCase();
  if (unit.startsWith('m')) return `M ${s.value.toFixed(1)}`;
  const n = s.value >= 100 ? Math.round(s.value).toLocaleString('en-US') : String(Math.round(s.value * 10) / 10);
  if (unit === 'hectare') return `${n} ha`;
  if (unit === 'acres') return `${n} acres`;
  return `${n} ${s.unit}`;
}

// ---- charity donations via Stripe Checkout (test mode) -----------------

export type CharityId = 'ifrc' | 'msf' | 'unicef' | 'wfp';
export interface Charity {
  id: CharityId;
  name: string;
  focus: string;
  /** The organisation's own website, for real donations. IMPACT's flow is test mode only. */
  officialUrl: string;
  /** 'connected_account': a destination charge to this charity's Stripe test account. 'platform_only': the test payment stays on IMPACT's test balance. */
  routing: 'connected_account' | 'platform_only';
}
export interface CharitiesResponse {
  enabled: boolean;
  problem: string | null;
  currency: string;
  minCents: number;
  maxCents: number;
  charities: Charity[];
}
export interface CharityDonationResult {
  sessionId: string;
  charityId: CharityId | null;
  charityName: string | null;
  /** True only when Stripe reports the Checkout Session as paid. */
  paid: boolean;
  sessionStatus: string | null;
  amountCents: number | null;
  currency: string | null;
  routedTo: string | null;
  /** Set only when Stripe reports a transfer on the charge. */
  transferId: string | null;
}

// ---- Stripe Connect donation (test mode) -------------------------------

export interface DonationConfig {
  enabled: boolean;
  problem: string | null;
  publishableKey: string | null;
  currency: string;
  minCents: number;
  maxCents: number;
  presetsCents: number[];
  charity: { name: string; accountId: string | null; transfersActive: boolean | null };
  chargeType: 'destination';
}
/** Server-side record. `confirmed*` fields only change in response to verified webhooks. */
export type DonationState = 'awaiting_payment' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'refunded';
export interface DonationStatus {
  id: string;
  amountCents: number;
  currency: string;
  state: DonationState;
  webhookConfirmed: boolean;
  transfer: { id: string; destination: string } | null;
  lastError: string | null;
  updatedAt: number;
}

// ---- safety planner -----------------------------------------------------

export const SAFETY_RADII_KM = [100, 250, 500, 1000] as const;
export const SAFETY_WINDOWS: Record<'7d' | '30d', string> = { '7d': 'Last 7 days', '30d': 'Last 30 days' };
export type SafetyWindow = keyof typeof SAFETY_WINDOWS;

export interface SafetyFact {
  ref: string; // "E1", "E2"... used by the AI to cite events
  eventId: string;
  category: HazardCategory;
  title: string;
  distanceKm: number;
  reportedAt: number | null;
  severity: string | null;
  sources: HazardSource[];
}
export interface SafetyLink { label: string; url: string; why: string }

/** A past event near the point, straight from USGS or NASA EONET. */
export interface HistoryEvent { id: string; title: string; time: number | null; distanceKm: number; magnitude: number | null; url: string | null }
export interface HistoryCategory {
  category: HazardCategory;
  count: number;
  firstYear: number | null;
  lastYear: number | null;
  /** Server-written, factual one-line summary of the record (counts and years). The AI never writes these. */
  basis: string;
  notable: HistoryEvent[];
}
export interface SafetyHistory {
  radiusKm: number;
  earthquakes: { ok: boolean; error?: string; since: string; minMagnitude: number; total: number; strong: number; major: number } | null;
  naturalEvents: { ok: boolean; error?: string; since: string } | null;
  categories: HistoryCategory[];
  notes: string[];
}

export type SafetyGuidance =
  | {
    status: 'ok'; model: string; generatedAt: number; summary: string;
    hazards: { category: HazardCategory; eventRefs: string[]; advice: string[] }[];
    /** Long-term risks from the history record: what to watch for and how to prepare. */
    watchFor: { category: HazardCategory; basis: string; signs: string[]; prepare: string[] }[];
    potentialIssues: string[];
    general: string[]; uncertainties: string[];
  }
  | { status: 'unavailable'; code: string; reason: string }
  | { status: 'not_generated'; reason: string };

export interface SafetyResponse {
  point: { latitude: number; longitude: number; region: string | null };
  radiusKm: number;
  range: TimeRange;
  facts: SafetyFact[];
  totalNearby: number;
  dataStatus: ProviderStatus[];
  limitations: string[];
  officialLinks: SafetyLink[];
  history: SafetyHistory | null;
  /** Set when the pin sits in a country Wikipedia currently lists as a location of an ongoing armed conflict. */
  conflictCountry: ConflictCountry | null;
  guidance: SafetyGuidance;
  disclaimer: string;
}

/** A country Wikipedia lists as a location of an ongoing armed conflict. Not a front line or official designation. */
export interface ConflictCountry {
  iso2: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number;
}
export interface ConflictsResponse {
  countries: ConflictCountry[];
  meta: {
    source: 'wikipedia';
    sourceUrl: string;
    pageTitle: string;
    fetchedAt: number;
    stale: boolean;
    unmappedNames: string[];
    notes: string[];
  };
}

export interface SmsAlertResult {
  configured: boolean;
  subscribed: boolean;
  last4: string | null;
  radiusKm: number;
  nearbyMajor: { title: string; category: HazardCategory; place: string | null }[];
  sent: { confirmation: boolean; alert: boolean };
}

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
