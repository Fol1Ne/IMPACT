import type { ApiErrorBody, BriefingResponse, CheckoutStatus, EventsResponse, FeedId, HealthResponse, PreparednessPackage, ResourceItem } from '@shared/types';

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
  resources: () => request<{ general: ResourceItem[]; incidentSpecificDonation: { verified: boolean; message: string } }>('/api/resources'),
  createCheckout: (eventId?: string) => request<{ url: string; id: string }>('/api/checkout/create-session', { method: 'POST', body: JSON.stringify({ product: 'enhanced-preparedness', ...(eventId ? { eventId } : {}) }) }),
  checkoutStatus: (sessionId: string) => request<CheckoutStatus>(`/api/checkout/session/${encodeURIComponent(sessionId)}`),
  preparedness: (sessionId: string, eventId: string) => request<{ package: PreparednessPackage }>(`/api/preparedness/${encodeURIComponent(sessionId)}?eventId=${encodeURIComponent(eventId)}`),
};
