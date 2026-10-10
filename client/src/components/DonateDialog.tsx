import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ExternalLink, HeartHandshake, Loader2, X, XCircle } from 'lucide-react';
import type { CharitiesResponse, CharityDonationResult, CharityId } from '@shared/types';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';

/** What the dialog opens on: the charity picker, or the result after Stripe Checkout sends the user back. */
export type DonateReturn = { kind: 'done'; sessionId: string } | { kind: 'cancelled' } | null;

export default function DonateDialog({ onClose, returned }: { onClose: () => void; returned: DonateReturn }) {
  const [data, setData] = useState<CharitiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [going, setGoing] = useState<CharityId | null>(null);
  const [showResult, setShowResult] = useState(returned?.kind === 'done');
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => { api.charities().then(setData).catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choose = async (id: CharityId) => {
    setGoing(id); setError(null);
    try {
      const { url } = await api.charityCheckout(id);
      if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error('Unexpected checkout address from the server.');
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setGoing(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel dialog donate charities" role="dialog" aria-modal="true" aria-labelledby="donate-title" tabIndex={-1} ref={dialog}>
        <header className="detail-head">
          <span className="badge"><HeartHandshake size={18} aria-hidden="true" /></span>
          <div><small>Stripe test mode · no real money moves</small><h2 id="donate-title">{showResult ? 'Your test donation' : 'Choose a charity'}</h2></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close donation dialog"><X size={16} /></button>
        </header>

        {showResult && returned?.kind === 'done' ? (
          <>
            <DonationResult sessionId={returned.sessionId} />
            <button type="button" className="btn" onClick={() => setShowResult(false)}>Donate to another charity</button>
          </>
        ) : (
          <>
            {returned?.kind === 'cancelled' && <p className="notice info small">Checkout was cancelled. Nothing was charged.</p>}
            <p className="notice info small">
              This is a <b>Stripe test-mode demo</b>: no real money moves, and no money reaches these organisations. Pay with a <a href="https://docs.stripe.com/testing" target="_blank" rel="noopener noreferrer">Stripe test card</a> such as 4242 4242 4242 4242. To give for real, use each organisation's own website.
            </p>
            {error && <p className="notice bad small" role="alert">{error}</p>}
            {!data && !error && <p className="muted"><Loader2 size={14} className="spin" aria-hidden="true" /> Loading charities…</p>}
            {data && !data.enabled && <p className="notice warn small" role="alert">Donations are unavailable: {data.problem}</p>}
            {data && (
              <ul className="charity-grid">
                {data.charities.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="charity-card" disabled={!data.enabled || going !== null} onClick={() => void choose(c.id)}>
                      <b>{c.name}</b>
                      <span className="small">{c.focus}</span>
                      <small className={c.routing === 'connected_account' ? 'route ok' : 'route'}>
                        {c.routing === 'connected_account' ? 'Routed to its Stripe test account' : 'Test payment stays on IMPACT\'s test balance'}
                      </small>
                      <span className="charity-go">{going === c.id ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Opening Stripe…</> : <>Donate with Stripe <ArrowRight size={13} aria-hidden="true" /></>}</span>
                    </button>
                    <a className="small charity-real" href={c.officialUrl} target="_blank" rel="noopener noreferrer">Official site <ExternalLink size={11} aria-hidden="true" /></a>
                  </li>
                ))}
              </ul>
            )}
            {data && (
              <p className="muted small">
                You choose the amount on Stripe's page ({formatMoney(data.minCents, data.currency)} to {formatMoney(data.maxCents, data.currency)}). Card details go to Stripe, never to IMPACT.
                {' '}Charities marked "routed" use a <b>destination charge</b>: Stripe transfers the full amount to that charity's test connected account.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DonationResult({ sessionId }: { sessionId: string }) {
  const [r, setR] = useState<CharityDonationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.charityDonation(sessionId).then(setR).catch((e: Error) => setError(e.message)); }, [sessionId]);
  if (error) return <p className="notice bad small" role="alert">{error}</p>;
  if (!r) return <p className="muted"><Loader2 size={14} className="spin" aria-hidden="true" /> Asking Stripe for the payment status…</p>;
  const amount = r.amountCents !== null && r.currency ? formatMoney(r.amountCents, r.currency) : 'Your donation';
  if (!r.paid) return <p className="notice warn small"><XCircle size={14} aria-hidden="true" /> Stripe does not report this payment as paid (status: {r.sessionStatus ?? 'unknown'}).</p>;
  return (
    <div className="donate-status ok">
      <p><CheckCircle2 size={18} aria-hidden="true" /> <b>Stripe confirmed your test payment of {amount}</b>{r.charityName ? ` for ${r.charityName}` : ''}.</p>
      {r.transferId
        ? <p className="small">Stripe recorded transfer <span className="mono">{r.transferId}</span> to the charity's test account <span className="mono">{r.routedTo}</span>.</p>
        : r.routedTo
          ? <p className="small">A transfer to the charity's test account <span className="mono">{r.routedTo}</span> is set up as a destination charge; Stripe has not reported the transfer yet.</p>
          : <p className="small">No charity test account is connected for this organisation yet, so the test payment stays on IMPACT's test balance and nothing was transferred.</p>}
      <p className="muted small">Test mode: no real money moved and the real organisation received nothing.</p>
    </div>
  );
}
