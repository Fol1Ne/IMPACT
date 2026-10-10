import {
  LONG_RANGE_DAYS, LONG_RANGE_MIN_MAGNITUDE, PROVIDERS, minMagnitudeFloor, rangeDays,
  type HazardCategory, type HazardEvent, type HazardsResponse, type Provider, type ProviderStatus, type QuakeEvent, type TimeRange,
} from '../../../shared/types';
import { HttpError } from '../errors';
import { EONET_WINDOW_DAYS, queryEonetRange } from './eonet';
import { mergeCrossSource } from './matching';
import { queryUsgsRange } from './usgs';

type FetchLike = typeof fetch;

export function quakeToHazard(q: QuakeEvent): HazardEvent {
  return {
    id: `usgs:${q.id}`,
    title: q.title,
    category: 'earthquakes',
    latitude: q.latitude,
    longitude: q.longitude,
    geometryType: 'point',
    track: [],
    startTime: q.time,
    updatedTime: q.updated ?? q.time,
    closedTime: null,
    severity: q.magnitude === null ? null : { value: q.magnitude, unit: q.magType ? `M (${q.magType})` : 'M', provider: 'usgs' },
    place: q.place,
    description: null,
    sources: [{ provider: 'usgs', providerId: q.id, url: q.url, label: 'USGS event page' }],
    quake: q,
    match: null,
  };
}

const LIMITS = {
  usgsOnlyQuakes: 'USGS supplies earthquakes only. Other natural hazards come from NASA EONET.',
  eonet: 'NASA EONET is a curated list of natural events; most records cite another agency (GDACS, IRWIN, JTWC and others), linked on each event. Markers are reported points or polygon centres, not fire perimeters or flood extents.',
  eonetSlow: `Long ranges are fetched from NASA EONET in ${EONET_WINDOW_DAYS}-day windows and cached; the first load of a long range can take up to a minute.`,
  conflictCountries: 'Armed conflict is shown as countries Wikipedia currently lists on "List of ongoing armed conflicts", not as dated event markers. That list is independent of the date filter and is not an official designation.',
  timezone: 'Times are stored in UTC and shown in your local time zone.',
};

export interface HazardQuery { range: TimeRange; minMagnitude: number; providers: Provider[]; categories?: HazardCategory[]; force?: boolean; fetchImpl?: FetchLike; now?: () => number }

/** The shared event query layer: globe, lists, notifications and the safety planner all read from here. */
export async function getHazards(q: HazardQuery): Promise<HazardsResponse> {
  const floor = minMagnitudeFloor(q.range);
  const minMagnitude = Math.max(q.minMagnitude, floor);
  const wants = (c: HazardCategory) => !q.categories || q.categories.includes(c);
  const useUsgs = q.providers.includes('usgs') && wants('earthquakes');
  const useEonet = q.providers.includes('eonet');
  const opts = { force: q.force, fetchImpl: q.fetchImpl, now: q.now };

  const [usgsRes, eonetRes] = await Promise.allSettled([
    useUsgs ? queryUsgsRange(q.range.start, q.range.end, minMagnitude, opts) : Promise.resolve(null),
    useEonet ? queryEonetRange(q.range.start, q.range.end, opts) : Promise.resolve(null),
  ]);

  const providers: ProviderStatus[] = [];
  const failed = (provider: Provider, res: PromiseSettledResult<unknown>) =>
    providers.push({ provider, ok: false, stale: false, partial: false, fetchedAt: null, count: 0, error: res.status === 'rejected' ? (res.reason as Error).message : 'unknown error', notes: [] });

  let usgs: HazardEvent[] = [];
  let eonet: HazardEvent[] = [];
  if (useUsgs) {
    if (usgsRes.status === 'fulfilled' && usgsRes.value) {
      usgs = usgsRes.value.events.map(quakeToHazard);
      const notes = [`Earthquakes of magnitude ${minMagnitude} and above.`];
      if (floor === LONG_RANGE_MIN_MAGNITUDE && floor > q.minMagnitude) notes.push(`Ranges longer than ${LONG_RANGE_DAYS} days are limited to M${LONG_RANGE_MIN_MAGNITUDE}+ because USGS caps one query at 20,000 events.`);
      providers.push({ provider: 'usgs', ok: true, stale: usgsRes.value.stale, partial: false, fetchedAt: usgsRes.value.fetchedAt, count: usgs.length, notes });
    } else failed('usgs', usgsRes);
  }
  if (useEonet) {
    if (eonetRes.status === 'fulfilled' && eonetRes.value) {
      const r = eonetRes.value;
      eonet = r.events.filter((e) => wants(e.category));
      const notes = r.failedWindows ? [`${r.failedWindows} of ${r.windows} date windows could not be loaded, so some events in this range are missing.`] : [];
      providers.push({ provider: 'eonet', ok: true, stale: r.stale, partial: r.failedWindows > 0, fetchedAt: r.fetchedAt, count: eonet.length, notes });
    } else failed('eonet', eonetRes);
  }
  if (providers.length > 0 && providers.every((p) => !p.ok)) {
    throw new HttpError(502, 'upstream_unavailable', `No event source could be reached: ${providers.map((p) => `${PROVIDERS[p.provider].label}: ${p.error}`).join('; ')}`);
  }

  const { events, merged } = mergeCrossSource(usgs, eonet);
  const limitations = [LIMITS.usgsOnlyQuakes, LIMITS.eonet];
  if (useEonet && rangeDays(q.range) > EONET_WINDOW_DAYS) limitations.push(LIMITS.eonetSlow);
  limitations.push(LIMITS.conflictCountries, LIMITS.timezone);
  return { events, meta: { range: q.range, minMagnitude, providers, merged, limitations, conflictSource: null } };
}
