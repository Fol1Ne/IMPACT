import { Activity, CircleDot, CloudFog, CloudLightning, Droplets, Factory, Flame, Mountain, Snowflake, Sun, Swords, Thermometer, Waves, type LucideIcon } from 'lucide-react';
import { BAND_COLORS, CATEGORIES, magnitudeBand, severityLabel, type HazardCategory, type HazardEvent } from '@shared/types';
import { shortPlace } from './format';

export const CATEGORY_ICONS: Record<HazardCategory, LucideIcon> = {
  earthquakes: Activity, wildfires: Flame, volcanoes: Mountain, floods: Waves, severeStorms: CloudLightning,
  drought: Sun, seaLakeIce: Snowflake, landslides: Mountain, dustHaze: CloudFog, snow: Snowflake,
  tempExtremes: Thermometer, waterColor: Droplets, manmade: Factory, conflict: Swords,
};

export function CategoryIcon({ category, size = 14 }: { category: HazardCategory; size?: number }) {
  const Icon = CATEGORY_ICONS[category] ?? CircleDot;
  return <Icon size={size} aria-hidden="true" />;
}

/** Earthquakes keep the magnitude-band colours; other categories use their category colour. */
export function hazardColor(e: HazardEvent): string {
  if (e.category === 'earthquakes') return BAND_COLORS[magnitudeBand(e.severity?.value ?? null)];
  return CATEGORIES[e.category].color;
}

export function hazardName(e: HazardEvent): string {
  return e.quake ? shortPlace(e.quake.place, e.title) : e.title;
}

export const hazardSeverity = (e: HazardEvent) => severityLabel(e.severity);
export const hazardTime = (e: HazardEvent) => e.updatedTime ?? e.startTime;
