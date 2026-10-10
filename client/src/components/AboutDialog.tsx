import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function AboutDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <h2 id="about-title">About IMPACT</h2>
        <p>IMPACT is an independent information platform. It is <b>not</b> an official emergency-management service. In an emergency, follow your local authorities and call your local emergency number.</p>
        <h3>Data</h3>
        <p>Earthquake events come from the <a href="https://earthquake.usgs.gov/earthquakes/feed/" target="_blank" rel="noopener noreferrer">USGS Earthquake Hazards Program</a> GeoJSON feeds. The time window, fetch time and any stale-data warning are shown in the header. Marker colour depends on magnitude only: under 4.5 cyan, 4.5 to 5.9 amber, 6 and above red.</p>
        <h3>AI briefings</h3>
        <p>Generated on demand by a model via OpenRouter from the USGS record only. Facts and AI interpretation are shown separately, and unknowns such as casualties or damage are never filled in.</p>
        <h3>Payments</h3>
        <p>The preparedness product uses Stripe in test mode. It is a software demonstration, not a donation.</p>
      </div>
    </div>
  );
}
