import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { CheckoutStatus } from '@shared/types';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { RETURN_EVENT_KEY, SESSION_KEY } from './PreparednessPanel';

type V = { s: 'checking' } | { s: 'error'; message: string } | { s: 'done'; status: CheckoutStatus };

export default function CheckoutReturn({ kind }: { kind: 'success' | 'cancel' }) {
  const [v, setV] = useState<V>({ s: 'checking' });
  const sessionId = new URLSearchParams(window.location.search).get('session_id');

  const verify = () => {
    if (!sessionId) { setV({ s: 'error', message: 'No checkout session was supplied.' }); return; }
    setV({ s: 'checking' });
    api.checkoutStatus(sessionId)
      .then((status) => { if (status.entitled) localStorage.setItem(SESSION_KEY, sessionId); setV({ s: 'done', status }); })
      .catch((e: Error) => setV({ s: 'error', message: e.message }));
  };
  useEffect(() => { if (kind === 'success') verify(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const back = () => {
    const ev = sessionStorage.getItem(RETURN_EVENT_KEY);
    window.location.assign(ev ? `/?event=${encodeURIComponent(ev)}&tab=preparedness` : '/');
  };

  return (
    <main className="return-page">
      <div className="panel return-card" role="status" aria-live="polite">
        {kind === 'cancel' && <><XCircle size={36} className="bad" aria-hidden="true" /><h1>Checkout cancelled</h1><p>No payment was taken. You can return to IMPACT and try again whenever you like.</p></>}
        {kind === 'success' && v.s === 'checking' && <><Loader2 size={36} className="spin" aria-hidden="true" /><h1>Verifying payment with Stripe…</h1><p>Visiting this page does not unlock anything by itself. IMPACT is asking Stripe for the real payment status.</p></>}
        {kind === 'success' && v.s === 'error' && <><XCircle size={36} className="bad" aria-hidden="true" /><h1>Could not verify the payment</h1><p>{v.message}</p><button type="button" className="btn" onClick={verify}>Try verification again</button></>}
        {kind === 'success' && v.s === 'done' && v.status.state === 'paid' && <><CheckCircle2 size={36} className="ok" aria-hidden="true" /><h1>Sandbox payment confirmed</h1><p>Stripe reports this test payment{v.status.amount !== null && v.status.currency ? ` of ${formatMoney(v.status.amount, v.status.currency)}` : ''} as paid. The Enhanced Preparedness Briefing is now unlocked.</p><p className="muted small">Test transaction. No real money was charged.</p></>}
        {kind === 'success' && v.s === 'done' && v.status.state !== 'paid' && <><XCircle size={36} className="warn" aria-hidden="true" /><h1>Payment not confirmed</h1><p>Stripe reports the payment as <b>{v.status.state}</b>, so nothing has been unlocked.</p><button type="button" className="btn" onClick={verify}>Check again</button></>}
        <button type="button" className="btn primary" onClick={back}>Back to IMPACT</button>
      </div>
    </main>
  );
}
