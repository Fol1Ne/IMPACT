import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, Lock, Printer } from 'lucide-react';
import type { HealthResponse, PreparednessPackage, QuakeEvent } from '@shared/types';
import { ApiError, api } from '../lib/api';
import { formatMoney } from '../lib/format';

export const SESSION_KEY = 'impact.checkoutSession';
export const RETURN_EVENT_KEY = 'impact.returnEvent';

export default function PreparednessPanel({ event, health, healthError }: { event: QuakeEvent; health: HealthResponse | null; healthError: string | null }) {
  const [pkg, setPkg] = useState<PreparednessPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setPkg(null);
    const sid = localStorage.getItem(SESSION_KEY);
    if (!sid) return;
    setChecking(true);
    api.preparedness(sid, event.id)
      .then((r) => setPkg(r.package))
      .catch((e: ApiError) => { if (e.status === 402) localStorage.removeItem(SESSION_KEY); else setErr(e.message); })
      .finally(() => setChecking(false));
  }, [event.id]);

  const buy = async () => {
    setBusy(true); setErr(null);
    try {
      const { url } = await api.createCheckout(event.id);
      sessionStorage.setItem(RETURN_EVENT_KEY, event.id);
      window.location.assign(url);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  if (pkg) {
    return (
      <div className="prep" id="prep-print">
        <p className="notice ok" role="status"><Check size={14} aria-hidden="true" /> Unlocked by a backend-verified Stripe test-mode purchase.</p>
        <h3>{pkg.eventContext.heading}</h3>
        <ul>{pkg.eventContext.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        {pkg.sections.map((s) => <div key={s.heading}><h3>{s.heading}</h3><ul className="check">{s.items.map((i, k) => <li key={k}>{i}</li>)}</ul></div>)}
        <h3>Official guidance</h3>
        <ul>{pkg.officialLinks.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <ExternalLink size={12} aria-hidden="true" /></a></li>)}</ul>
        <p className="muted small">{pkg.notice}</p>
        <button type="button" className="btn" onClick={() => window.print()}><Printer size={14} aria-hidden="true" /> Print checklist</button>
      </div>
    );
  }

  const p = health?.product;
  const configured = health?.stripe.configured ?? false;
  return (
    <div className="prep">
      <h3>{p?.name ?? 'Enhanced Preparedness Briefing'}</h3>
      <p>{p?.description}</p>
      {p && <ul className="check">{p.includes.map((i) => <li key={i}>{i}</li>)}</ul>}
      <p className="price">{p ? formatMoney(p.priceCents, p.currency) : '…'} <small>one-time · Stripe sandbox</small></p>
      <p className="notice info"><Lock size={14} aria-hidden="true" /> Test mode only. Use Stripe's test card 4242 4242 4242 4242. No real money moves, and this is not a donation.</p>
      {healthError && <p className="notice bad" role="alert">Could not load product details: {healthError}</p>}
      {health && !configured && <p className="notice warn" role="status">Checkout is not configured: {health.stripe.problem ?? 'set STRIPE_SECRET_KEY'}. Add a test key to <span className="mono">.env</span> and restart.</p>}
      {err && <p className="notice bad" role="alert">{err}</p>}
      {checking && <p className="muted small"><Loader2 size={14} className="spin" aria-hidden="true" /> Checking for an existing purchase…</p>}
      <button type="button" className="btn primary" onClick={buy} disabled={busy || !configured}>{busy ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Opening Stripe…</> : 'Unlock Enhanced Preparedness Briefing'}</button>
    </div>
  );
}
