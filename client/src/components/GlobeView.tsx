import { useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { BAND_COLORS, magnitudeBand, type QuakeEvent } from '@shared/types';
import { prefersReducedMotion, shortPlace } from '../lib/format';

interface Props { events: QuakeEvent[]; selectedId: string | null; onSelect: (id: string) => void }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export default function GlobeView({ events, selectedId, onSelect }: Props) {
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 520 });
  const reduced = useMemo(prefersReducedMotion, []);
  const selected = useMemo(() => events.find((e) => e.id === selectedId) ?? null, [events, selectedId]);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.max(260, entry.contentRect.width), h: Math.max(260, entry.contentRect.height) });
    });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const ready = () => {
    const g = globe.current;
    if (!g) return;
    const c = g.controls() as { autoRotate: boolean; autoRotateSpeed: number; enablePan?: boolean };
    c.autoRotate = !reduced;
    c.autoRotateSpeed = 0.35;
    g.pointOfView({ lat: 20, lng: 10, altitude: 2.3 }, 0);
  };

  useEffect(() => {
    const g = globe.current;
    if (!g || !selected) return;
    (g.controls() as { autoRotate: boolean }).autoRotate = false; // stop spinning once the user picks something
    g.pointOfView({ lat: selected.latitude, lng: selected.longitude, altitude: 1.4 }, reduced ? 0 : 900);
  }, [selected, reduced]);

  const zoom = (factor: number) => {
    const g = globe.current;
    if (!g) return;
    const pov = g.pointOfView();
    g.pointOfView({ ...pov, altitude: Math.min(4, Math.max(0.3, pov.altitude * factor)) }, reduced ? 0 : 400);
  };
  const globalView = () => {
    const g = globe.current;
    if (!g) return;
    g.pointOfView({ lat: 20, lng: 10, altitude: 2.3 }, reduced ? 0 : 900);
  };
  const toSelected = () => { if (selected) globe.current?.pointOfView({ lat: selected.latitude, lng: selected.longitude, altitude: 1.2 }, reduced ? 0 : 700); };

  const rings = useMemo(() => events.filter((e) => e.id === selectedId || (e.magnitude ?? 0) >= 6), [events, selectedId]);

  return (
    <div className="globe-wrap" ref={box}>
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
        pointsData={events}
        pointLat="latitude"
        pointLng="longitude"
        pointColor={(d) => BAND_COLORS[magnitudeBand((d as QuakeEvent).magnitude)]}
        pointAltitude={(d) => ((d as QuakeEvent).id === selectedId ? 0.14 : 0.01 + Math.max(0, (d as QuakeEvent).magnitude ?? 0) * 0.004)}
        pointRadius={(d) => ((d as QuakeEvent).id === selectedId ? 0.7 : 0.28 + Math.max(0, (d as QuakeEvent).magnitude ?? 0) * 0.03)}
        pointResolution={10}
        pointLabel={(d) => {
          const e = d as QuakeEvent;
          return `<div class="globe-tip"><b>${e.magnitude === null ? 'M ?' : `M ${e.magnitude.toFixed(1)}`}</b> ${esc(shortPlace(e.place, e.title))}</div>`;
        }}
        onPointClick={(d) => onSelect((d as QuakeEvent).id)}
        ringsData={rings}
        ringLat="latitude"
        ringLng="longitude"
        ringColor={(d: object) => () => BAND_COLORS[magnitudeBand((d as QuakeEvent).magnitude)]}
        ringMaxRadius={(d) => ((d as QuakeEvent).id === selectedId ? 5 : 3)}
        ringPropagationSpeed={reduced ? 0 : 2}
        ringRepeatPeriod={reduced ? 0 : 1800}
      />
      <div className="globe-controls" role="group" aria-label="Globe controls">
        <button type="button" onClick={() => zoom(0.7)} aria-label="Zoom in"><Plus size={18} /></button>
        <button type="button" onClick={() => zoom(1 / 0.7)} aria-label="Zoom out"><Minus size={18} /></button>
        <button type="button" onClick={selected ? toSelected : globalView} aria-label={selected ? 'Centre on selected event' : 'Return to global view'}><Crosshair size={18} /></button>
        {selected && <button type="button" className="text-btn" onClick={globalView}>Global view</button>}
      </div>
    </div>
  );
}
