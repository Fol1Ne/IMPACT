import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import occupiedTerritories from '../data/occupied-territories.json';

countries.registerLocale(en);

export interface Country { iso2: string | null; name: string; latitude: number; longitude: number; altitude: number }
export interface CountryProps extends Country { occupied?: boolean; territoryName?: string }
export type CountryFeature = Feature<Geometry, CountryProps>;

// world-atlas leaves these without a numeric ISO id.
const NAME_TO_ISO2: Record<string, string> = { Kosovo: 'XK' };

const CAMERA_OVERRIDES: Record<string, { latitude: number; longitude: number; altitude: number }> = {
  US: { latitude: 39.5, longitude: -98.35, altitude: 1.1 },
  RU: { latitude: 58, longitude: 70, altitude: 1.9 },
  CA: { latitude: 58, longitude: -96, altitude: 1.3 },
  CN: { latitude: 35.5, longitude: 103.5, altitude: 1.1 },
  AU: { latitude: -25.5, longitude: 134, altitude: 1.15 },
  BR: { latitude: -10.5, longitude: -52, altitude: 1.1 },
  FR: { latitude: 46.6, longitude: 2.4, altitude: 0.6 },
  NO: { latitude: 64.5, longitude: 12.5, altitude: 0.75 },
  NZ: { latitude: -41.2, longitude: 174.2, altitude: 0.6 },
  GB: { latitude: 54.2, longitude: -2.6, altitude: 0.55 },
};

function ringBox(ring: Position[]) {
  const lngs = ring.map((p) => p[0] ?? 0);
  const wraps = Math.max(...lngs) - Math.min(...lngs) > 180;
  let minLng = 360, maxLng = -360, minLat = 90, maxLat = -90;
  for (const p of ring) {
    const lng = wraps && (p[0] ?? 0) < 0 ? (p[0] ?? 0) + 360 : (p[0] ?? 0);
    const lat = p[1] ?? 0;
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  return { minLng, maxLng, minLat, maxLat };
}

/** Centre the camera on the largest ring, zoomed out enough to fit it. */
function cameraTarget(geometry: Geometry) {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.type === 'MultiPolygon' ? geometry.coordinates.map((p) => p[0]) : [];
  let best: ReturnType<typeof ringBox> | null = null;
  let bestArea = -1;
  for (const ring of rings) {
    if (!ring?.length) continue;
    const box = ringBox(ring);
    const area = (box.maxLng - box.minLng) * (box.maxLat - box.minLat);
    if (area > bestArea) { best = box; bestArea = area; }
  }
  if (!best) return { latitude: 0, longitude: 0, altitude: 2.3 };
  let longitude = (best.minLng + best.maxLng) / 2;
  if (longitude > 180) longitude -= 360;
  const span = Math.max(Math.min(best.maxLng - best.minLng, 180), best.maxLat - best.minLat);
  const altitude = span > 60 ? 1.7 : span > 35 ? 1.3 : span > 18 ? 0.95 : span > 8 ? 0.7 : 0.5;
  return { latitude: (best.minLat + best.maxLat) / 2, longitude, altitude };
}

export function loadCountryFeatures(): CountryFeature[] {
  const topology = world as unknown as Topology<{ countries: GeometryCollection }>;
  const collection = feature(topology, topology.objects.countries) as unknown as FeatureCollection;
  const out: CountryFeature[] = [];
  for (const item of collection.features) {
    if (!item.geometry || (item.geometry.type !== 'Polygon' && item.geometry.type !== 'MultiPolygon')) continue;
    const name = (item.properties as { name?: string } | null)?.name?.trim() || 'Unnamed area';
    const numeric = item.id == null ? undefined : String(item.id).padStart(3, '0');
    const iso2 = (numeric && countries.numericToAlpha2(numeric)) || NAME_TO_ISO2[name] || null;
    const target = (iso2 && CAMERA_OVERRIDES[iso2]) || cameraTarget(item.geometry);
    out.push({ type: 'Feature', id: item.id ?? name, geometry: item.geometry, properties: { iso2, name, ...target } });
  }
  out.sort((a, b) => a.properties.name.localeCompare(b.properties.name));

  // Occupied Ukrainian oblasts are drawn on top, attributed to Russia's news query but visibly distinct.
  const ru = out.find((c) => c.properties.iso2 === 'RU')?.properties;
  for (const territory of occupiedTerritories.features) {
    if (!ru || territory.geometry.type !== 'Polygon') continue;
    out.push({
      type: 'Feature', id: `occupied-${territory.properties.name}`, geometry: territory.geometry as Geometry,
      properties: { ...ru, occupied: true, territoryName: territory.properties.name },
    });
  }
  return out;
}

function ringContains(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? [];
    const [xj = 0, yj = 0] = ring[j] ?? [];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(lng: number, lat: number, g: Geometry): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some(([outer, ...holes]) => Boolean(outer) && ringContains(lng, lat, outer!) && !holes.some((h) => ringContains(lng, lat, h)));
}

const bboxes = new WeakMap<CountryFeature, [number, number, number, number]>();
function bbox(f: CountryFeature): [number, number, number, number] {
  let b = bboxes.get(f);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) for (const [x = 0, y = 0] of poly[0] ?? []) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    bboxes.set(f, b);
  }
  return b;
}
const contains = (f: CountryFeature, lat: number, lng: number) => {
  const [x0, y0, x1, y1] = bbox(f);
  return lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1 && pointInGeometry(lng, lat, f.geometry);
};

/** The country whose boundary contains a point, or null for open ocean and unmapped areas. Occupied overlays win so they are labelled correctly. */
export function countryAt(features: CountryFeature[], lat: number, lng: number): CountryFeature | null {
  const hits = features.filter((f) => contains(f, lat, lng));
  return hits.find((f) => f.properties.occupied) ?? hits[0] ?? null;
}

/** A fast membership test for one country, consistent with countryAt (occupied overlays belong to the country they are attributed to). */
export function countryMatcher(features: CountryFeature[], key: string): (lat: number, lng: number) => boolean {
  const own = features.filter((f) => countryKey(f.properties) === key);
  const foreignOverlays = features.filter((f) => f.properties.occupied && countryKey(f.properties) !== key);
  return (lat, lng) => own.some((f) => contains(f, lat, lng)) && !foreignOverlays.some((f) => contains(f, lat, lng));
}

export const toCountry = ({ iso2, name, latitude, longitude, altitude }: CountryProps): Country => ({ iso2, name, latitude, longitude, altitude });
export const countryKey = (c: { iso2: string | null; name: string } | null | undefined) => (c ? (c.iso2 ?? c.name) : '');
