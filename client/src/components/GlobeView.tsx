import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { CATEGORIES, severityLabel, type HazardEvent } from '@shared/types';
import { countryKey, toCountry, type Country, type CountryFeature } from '../lib/countries';
import { prefersReducedMotion } from '../lib/format';
import { hazardColor, hazardName } from '../lib/hazards';

export interface LatLng { lat: number; lng: number }

interface Props {
  events: HazardEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  countries: CountryFeature[];
  selectedCountry: Country | null;
  onSelectCountry: (country: Country) => void;
  conflictIso2: Set<string>;
  showConflict: boolean;
  /** While true, any click on the globe places the safety-planner pin instead of selecting things. */
  pickMode: boolean;
  pin: LatLng | null;
  onPick: (p: LatLng) => void;
  /** Bumped by the parent to fly to a specific point (notifications, planner). */
  focus: { lat: number; lng: number; altitude: number; tick: number } | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const GLOBAL_POV = { lat: 20, lng: 10, altitude: 1.9 };

type HtmlMark =
  | { kind: 'event'; lat: number; lng: number; event: HazardEvent; selected: boolean }
  | { kind: 'pin'; lat: number; lng: number };

function circlePx(e: HazardEvent, selected: boolean): number {
  if (selected) return 16;
  if (e.category === 'earthquakes') return 8 + Math.min(8, Math.max(0, (e.severity?.value ?? 2.5) - 2.5) * 1.5);
  return 9;
}

export default function GlobeView({ events, selectedId, onSelect, countries, selectedCountry, onSelectCountry, conflictIso2, showConflict, pickMode, pin, onPick, focus }: Props) {
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [size, setSize] = useState({ w: 600, h: 520 });
  const [hoveredKey, setHoveredKey] = useState('');
  const reduced = useMemo(prefersReducedMotion, []);
  const selected = useMemo(() => events.find((e) => e.id === selectedId) ?? null, [events, selectedId]);
  const selectedKey = countryKey(selectedCountry);
  const hadCountry = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.max(260, entry.contentRect.width), h: Math.max(260, entry.contentRect.height) });
    });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const stopSpin = () => { const g = globe.current; if (g) (g.controls() as { autoRotate: boolean }).autoRotate = false; };
  const fly = useCallback((pov: { lat: number; lng: number; altitude: number }, ms = 900) => {
    stopSpin();
    globe.current?.pointOfView(pov, reduced ? 0 : ms);
  }, [reduced]);

  const ready = () => {
    const g = globe.current;
    if (!g) return;
    const c = g.controls() as { autoRotate: boolean; autoRotateSpeed: number };
    c.autoRotate = !reduced;
    c.autoRotateSpeed = 0.35;
    g.pointOfView(GLOBAL_POV, 0);
  };

  useEffect(() => { if (selected) fly({ lat: selected.latitude, lng: selected.longitude, altitude: 1.4 }); }, [selected, fly]);
  useEffect(() => {
    if (selectedCountry) { hadCountry.current = true; fly({ lat: selectedCountry.latitude, lng: selectedCountry.longitude, altitude: selectedCountry.altitude }); }
    else if (hadCountry.current) { hadCountry.current = false; fly(GLOBAL_POV); }
  }, [selectedCountry, fly]);
  useEffect(() => { if (focus) fly({ lat: focus.lat, lng: focus.lng, altitude: focus.altitude }); }, [focus, fly]);
  useEffect(() => { if (pickMode) stopSpin(); }, [pickMode]);

  const inConflict = useCallback((p: CountryFeature['properties']) => Boolean(showConflict && p.iso2 && conflictIso2.has(p.iso2)), [showConflict, conflictIso2]);

  const capColor = useCallback((d: object) => {
    const p = (d as CountryFeature).properties;
    const key = countryKey(p);
    if (key === selectedKey) return p.occupied ? 'rgba(34,211,238,0.16)' : 'rgba(34,211,238,0.28)';
    if (inConflict(p)) return 'rgba(244,63,94,0.32)';
    if (key === hoveredKey && !pickMode) return 'rgba(148,180,255,0.18)';
    return p.occupied ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0)';
  }, [hoveredKey, selectedKey, pickMode, inConflict]);
  const strokeColor = useCallback((d: object) => {
    const p = (d as CountryFeature).properties;
    if (countryKey(p) === selectedKey) return 'rgba(34,211,238,0.95)';
    if (inConflict(p)) return 'rgba(244,63,94,0.85)';
    return p.occupied ? 'rgba(255,255,255,0.35)' : 'rgba(148,180,255,0.28)';
  }, [selectedKey, inConflict]);
  const polygonAltitude = useCallback((d: object) => {
    const p = (d as CountryFeature).properties;
    return (countryKey(p) === selectedKey ? 0.009 : inConflict(p) ? 0.006 : 0.004) + (p.occupied ? 0.002 : 0);
  }, [selectedKey, inConflict]);

  const zoom = (factor: number) => {
    const g = globe.current;
    if (!g) return;
    const pov = g.pointOfView();
    g.pointOfView({ ...pov, altitude: Math.min(4, Math.max(0.3, pov.altitude * factor)) }, reduced ? 0 : 400);
  };
  const globalView = () => fly(GLOBAL_POV);
  const toSelected = () => { if (selected) fly({ lat: selected.latitude, lng: selected.longitude, altitude: 1.2 }, 700); };

  const rings = useMemo(() => events.filter((e) => e.id === selectedId || (e.category === 'earthquakes' && (e.severity?.value ?? 0) >= 6)), [events, selectedId]);
  const paths = useMemo(() => (selected && selected.track.length > 1 ? [selected] : []), [selected]);
  const htmlData = useMemo<HtmlMark[]>(() => {
    const marks: HtmlMark[] = events.map((e) => ({ kind: 'event', lat: e.latitude, lng: e.longitude, event: e, selected: e.id === selectedId }));
    if (pin) marks.push({ kind: 'pin', lat: pin.lat, lng: pin.lng });
    return marks;
  }, [events, selectedId, pin]);

  return (
    <div className={pickMode ? 'globe-wrap picking' : 'globe-wrap'} ref={box}>
      <Globe
        ref={globe}
        width={size.w}
        height={size.h}
        globeImageUrl="/textures/earth-night.jpg"
        bumpImageUrl="/textures/earth-topology.png"
        backgroundImageUrl="/textures/night-sky.png"
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#3b82f6"
        atmosphereAltitude={0.2}
        onGlobeReady={ready}
        onGlobeClick={(c) => { if (pickMode) onPick(c); }}
        htmlElementsData={htmlData}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude={0.012}
        htmlTransitionDuration={0}
        htmlElement={(d) => {
          const mark = d as HtmlMark;
          if (mark.kind === 'pin') {
            const el = document.createElement('div');
            el.className = 'planner-pin';
            el.setAttribute('aria-hidden', 'true');
            return el;
          }
          const e = mark.event;
          const el = document.createElement('button');
          el.type = 'button';
          const px = circlePx(e, mark.selected);
          el.className = mark.selected ? 'globe-dot sel' : 'globe-dot';
          el.style.width = `${px}px`;
          el.style.height = `${px}px`;
          el.style.background = hazardColor(e);
          const sev = severityLabel(e.severity);
          el.title = `${CATEGORIES[e.category].label}${sev ? ` · ${sev}` : ''} — ${hazardName(e)}`;
          el.setAttribute('aria-label', el.title);
          el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            onSelectRef.current(e.id);
          });
          return el;
        }}
        ringsData={rings}
        ringLat="latitude"
        ringLng="longitude"
        ringColor={(d: object) => () => hazardColor(d as HazardEvent)}
        ringMaxRadius={(d) => ((d as HazardEvent).id === selectedId ? 5 : 3)}
        ringPropagationSpeed={reduced ? 0 : 2}
        ringRepeatPeriod={reduced ? 0 : 1800}
        pathsData={paths}
        pathPoints={(d) => (d as HazardEvent).track}
        pathPointLat={(p) => (p as [number, number])[1]}
        pathPointLng={(p) => (p as [number, number])[0]}
        pathColor={(d: object) => hazardColor(d as HazardEvent)}
        pathStroke={1.5}
        pathDashLength={0.02}
        pathDashGap={0.008}
        pathDashAnimateTime={reduced ? 0 : 8000}
        polygonsData={countries}
        polygonCapColor={capColor}
        polygonSideColor={() => 'rgba(0,0,0,0)'}
        polygonStrokeColor={strokeColor}
        polygonAltitude={polygonAltitude}
        polygonsTransitionDuration={reduced ? 0 : 200}
        polygonLabel={(d) => {
          const p = (d as CountryFeature).properties;
          const war = inConflict(p) ? 'Listed as a current conflict location' : '';
          const label = p.occupied && p.territoryName ? `${p.territoryName}: occupied territory shown with Russia, not part of the country` : p.name;
          return `<div class="globe-tip">${esc(label)}${war ? `<small>${esc(war)}</small>` : ''}<small>${pickMode ? 'Click to place the planner pin' : 'Click for news'}</small></div>`;
        }}
        onPolygonHover={(d) => setHoveredKey(countryKey((d as CountryFeature | null)?.properties))}
        onPolygonClick={(d, _e, c) => (pickMode ? onPick(c) : onSelectCountry(toCountry((d as CountryFeature).properties)))}
      />
      <div className="globe-controls" role="group" aria-label="Globe controls">
        <button type="button" onClick={() => zoom(0.7)} aria-label="Zoom in"><Plus size={18} /></button>
        <button type="button" onClick={() => zoom(1 / 0.7)} aria-label="Zoom out"><Minus size={18} /></button>
        <button type="button" onClick={selected ? toSelected : globalView} aria-label={selected ? 'Centre on selected event' : 'Return to global view'}><Crosshair size={18} /></button>
        {(selected || selectedCountry) && <button type="button" className="text-btn" onClick={globalView}>Global view</button>}
      </div>
    </div>
  );
}
