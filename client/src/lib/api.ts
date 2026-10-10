import type { ApiErrorBody, BriefingResponse, CharitiesResponse, CharityDonationResult, CharityId, CheckoutStatus, ConflictsResponse, EventsResponse, FeedId, HazardsResponse, HealthResponse, NewsResponse, PreparednessPackage, RangePreset, ResourceItem, SafetyResponse, SafetyWindow, SmsAlertResult } from '@shared/types';

export type RangeSelection = { preset: RangePreset } | { start: string; end: string };
export const rangeQuery = (r: RangeSelection) => ('preset' in r ? `range=${r.preset}` : `start=${encodeURIComponent(r.start)}&end=${encodeURIComponent(r.end)}`);

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the IMPACT server. Is it running?');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong.');
  }
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  events: (feed: FeedId, refresh = false) => request<EventsResponse>(`/api/events?feed=${encodeURIComponent(feed)}${refresh ? '&refresh=1' : ''}`),
  briefing: (eventId: string) => request<BriefingResponse>('/api/briefings', { method: 'POST', body: JSON.stringify({ eventId }) }),
  hazards: (range: RangeSelection, refresh = false, signal?: AbortSignal) => request<HazardsResponse>(`/api/hazards?${rangeQuery(range)}${refresh ? '&refresh=1' : ''}`, { signal }),
  news: (country: string | null, refresh = false, signal?: AbortSignal) => request<NewsResponse>(`/api/news?${country ? `country=${encodeURIComponent(country)}` : 'scope=global'}${refresh ? '&refresh=1' : ''}`, { signal }),
  resources: () => request<{ general: ResourceItem[]; incidentSpecificDonation: { verified: boolean; message: string } }>('/api/resources'),
  createCheckout: (eventId?: string) => request<{ url: string; id: string }>('/api/checkout/create-session', { method: 'POST', body: JSON.stringify({ product: 'enhanced-preparedness', ...(eventId ? { eventId } : {}) }) }),
  checkoutStatus: (sessionId: string) => request<CheckoutStatus>(`/api/checkout/session/${encodeURIComponent(sessionId)}`),
  safety: (body: { latitude: number; longitude: number; radiusKm: number; window: SafetyWindow; region: string | null; iso2: string | null }, signal?: AbortSignal) => request<SafetyResponse>('/api/safety', { method: 'POST', body: JSON.stringify(body), signal }),
  conflicts: (refresh = false, signal?: AbortSignal) => request<ConflictsResponse>(`/api/conflicts${refresh ? '?refresh=1' : ''}`, { signal }),
  smsAlert: (body: { phone: string; latitude: number; longitude: number; radiusKm: number }) => request<SmsAlertResult>('/api/alerts/sms', { method: 'POST', body: JSON.stringify(body) }),
  smsCancel: (phone: string) => request<{ cancelled: boolean }>('/api/alerts/sms/cancel', { method: 'POST', body: JSON.stringify({ phone }) }),
  charities: () => request<CharitiesResponse>('/api/charities'),
  charityCheckout: (charityId: CharityId) => request<{ url: string; id: string }>('/api/charities/checkout', { method: 'POST', body: JSON.stringify({ charityId }) }),
  charityDonation: (sessionId: string) => request<CharityDonationResult>(`/api/charities/donation/${encodeURIComponent(sessionId)}`),
  preparedness: (sessionId: string, eventId: string) => request<{ package: PreparednessPackage }>(`/api/preparedness/${encodeURIComponent(sessionId)}?eventId=${encodeURIComponent(eventId)}`),
};
