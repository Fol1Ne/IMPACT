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
        <p>Earthquakes come from the <a href="https://earthquake.usgs.gov/fdsnws/event/1/" target="_blank" rel="noopener noreferrer">USGS Earthquake Hazards Program</a>. Wildfires, storms, volcanoes, floods and other natural events come from <a href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noopener noreferrer">NASA EONET</a>, which curates reports from other agencies; each event links to its source records. Ranges longer than 31 days show earthquakes of M4.5 and above. Quake colour depends on magnitude only; other events are coloured by type. Armed-conflict events, when the server has credentials, come from <a href="https://acleddata.com/" target="_blank" rel="noopener noreferrer">ACLED</a> or the <a href="https://ucdp.uu.se/" target="_blank" rel="noopener noreferrer">UCDP</a> Candidate dataset (CC BY 4.0); they are reported incidents, not front lines or official warnings. Headlines come from Google News and are coverage, not verified event records.</p>
        <h3>AI</h3>
        <p>Earthquake briefings and the safety planner use a model via OpenRouter, given only the source records. Hazard advice is limited to event types actually reported nearby, nothing is invented, and finding no events never means an area is safe.</p>
        <h3>Notifications</h3>
        <p>Opt-in, in this tab only, stored in this browser. They are not official alerts.</p>
        <h3>Payments</h3>
        <p>Both payment flows use Stripe in test mode. The preparedness package is a software purchase, not a donation. The donation goes to a Stripe test connected account standing in for a charity; no real money moves.</p>
      </div>
    </div>
  );
}
