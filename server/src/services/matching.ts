import { haversineKm, type HazardEvent } from '../../../shared/types';

/** Proximity matching is deliberately strict: all three conditions must hold, and only one candidate may qualify. */
export const MATCH_MAX_SECONDS = 5 * 60;
export const MATCH_MAX_KM = 30;
export const MATCH_MAX_MAG_DIFF = 0.3;

const USGS_EVENT_PAGE = /earthquake\.usgs\.gov\/earthquakes\/eventpage\/([a-z0-9]{4,40})/i;

export function citedUsgsId(e: HazardEvent): string | null {
  for (const s of e.sources) {
    const m = s.url ? USGS_EVENT_PAGE.exec(s.url) : null;
    if (m?.[1]) return m[1].toLowerCase();
  }
  return null;
}

function proximityCandidates(eq: HazardEvent, usgs: HazardEvent[]) {
  if (eq.startTime === null || !eq.severity) return [];
  return usgs.filter((u) => {
    if (u.startTime === null || !u.severity) return false;
    if (Math.abs(u.startTime - eq.startTime!) > MATCH_MAX_SECONDS * 1000) return false;
    if (Math.abs(u.severity.value - eq.severity!.value) > MATCH_MAX_MAG_DIFF) return false;
    return haversineKm(u.latitude, u.longitude, eq.latitude, eq.longitude) <= MATCH_MAX_KM;
  });
}

function merge(base: HazardEvent, other: HazardEvent, match: NonNullable<HazardEvent['match']>): HazardEvent {
  return { ...base, sources: [...base.sources, ...other.sources], match };
}

/**
 * Combine USGS and EONET records that describe the same earthquake. USGS stays the base record
 * (its magnitude, depth, time and place are kept); EONET's source links are appended so both remain visible.
 * Deterministic: inputs are processed in id order and each USGS record matches at most one EONET record.
 */
export function mergeCrossSource(usgs: HazardEvent[], eonet: HazardEvent[]): { events: HazardEvent[]; merged: number } {
  const usgsById = new Map(usgs.map((u) => [u.quake?.id.toLowerCase() ?? u.id, u]));
  const used = new Set<string>();
  const out = new Map(usgs.map((u) => [u.id, u]));
  const unmatched: HazardEvent[] = [];
  let merged = 0;

  for (const eq of [...eonet].sort((a, b) => a.id.localeCompare(b.id))) {
    if (eq.category !== 'earthquakes') { unmatched.push(eq); continue; }
    const cited = citedUsgsId(eq);
    const byId = cited ? usgsById.get(cited) : undefined;
    if (byId && !used.has(byId.id)) {
      used.add(byId.id);
      out.set(byId.id, merge(out.get(byId.id)!, eq, { method: 'identifier', note: `NASA EONET cites USGS event ${cited}.` }));
      merged++;
      continue;
    }
    const candidates = proximityCandidates(eq, usgs).filter((u) => !used.has(u.id)).sort((a, b) => a.id.localeCompare(b.id));
    if (candidates.length === 1) {
      const u = candidates[0]!;
      const dt = Math.round(Math.abs(u.startTime! - eq.startTime!) / 1000);
      const km = haversineKm(u.latitude, u.longitude, eq.latitude, eq.longitude);
      used.add(u.id);
      out.set(u.id, merge(out.get(u.id)!, eq, { method: 'proximity', note: `Matched on time (${dt} s apart), distance (${km.toFixed(1)} km) and magnitude (within ${MATCH_MAX_MAG_DIFF}).` }));
      merged++;
      continue;
    }
    unmatched.push(eq);
  }
  return { events: [...out.values(), ...unmatched], merged };
}
