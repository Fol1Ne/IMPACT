import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import type { BriefingResponse, HealthResponse, QuakeEvent } from '@shared/types';
import { ApiError, api } from '../lib/api';
import { formatUtc } from '../lib/format';

type State = { s: 'idle' } | { s: 'loading' } | { s: 'error'; code: string; message: string } | { s: 'done'; data: BriefingResponse };

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="muted small">{empty}</p>;
}

export default function BriefingPanel({ event, health }: { event: QuakeEvent; health: HealthResponse | null }) {
  const [st, setSt] = useState<State>({ s: 'idle' });
  const notConfigured = health !== null && !health.openrouter.configured;

  const run = async () => {
    setSt({ s: 'loading' });
    try { setSt({ s: 'done', data: await api.briefing(event.id) }); }
    catch (e) { const err = e as ApiError; setSt({ s: 'error', code: err.code, message: err.message }); }
  };

  if (st.s === 'done') {
    const { briefing: b, meta } = st.data;
    return (
      <div className="briefing">
        <p className="meta-line"><Sparkles size={14} aria-hidden="true" /> AI-generated via OpenRouter · model <span className="mono">{meta.model}</span> · {meta.cached ? 'served from server cache' : 'generated just now'} · {formatUtc(meta.generatedAt)}</p>
        <div className="block source">
          <h3><CheckCircle2 size={16} aria-hidden="true" /> Source data (from USGS, not AI)</h3>
          <dl className="kv">{b.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
        </div>
        <div className="block ai"><h3>Situation overview <em>AI summary of the data above</em></h3><p>{b.overview}</p></div>
        <div className="block ai"><h3>Potential significance <em>AI interpretation</em></h3><Bullets items={b.potentialSignificance} empty="No interpretation offered." /></div>
        <div className="block gap"><h3><AlertTriangle size={16} aria-hidden="true" /> Information gaps</h3><Bullets items={b.informationGaps} empty="None listed." /></div>
        <div className="block ai"><h3>Humanitarian considerations <em>general, not confirmed needs</em></h3><Bullets items={b.humanitarianConsiderations} empty="None listed." /></div>
        <div className="block ai"><h3>Information worth seeking</h3><Bullets items={b.recommendedInformation} empty="None listed." /></div>
        <div className="block"><h3>Sources</h3>
          <ul>{b.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label} <ExternalLink size={12} aria-hidden="true" /></a><small> {s.role}</small></li>)}</ul>
        </div>
        <div className="block limits"><h3>Limitations</h3><ul>{b.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
      </div>
    );
  }

  return (
    <div className="briefing">
      <p>Generate a briefing for this event. Facts come straight from USGS; the model only adds clearly labelled interpretation, unknowns and general considerations.</p>
      {notConfigured && <div className="notice warn" role="status">AI generation is not configured. Add <span className="mono">OPENROUTER_API_KEY</span> to <span className="mono">.env</span> and restart the server. The rest of IMPACT works without it.</div>}
      {st.s === 'error' && (
        <div className="notice bad" role="alert">
          <b>{st.code === 'ai_not_configured' ? 'AI is not configured' : 'Briefing failed'}</b>
          <p>{st.message}</p>
        </div>
      )}
      <button type="button" className="btn primary" onClick={run} disabled={st.s === 'loading' || notConfigured} aria-busy={st.s === 'loading'}>
        {st.s === 'loading' ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Generating…</> : st.s === 'error' ? <><RotateCcw size={16} aria-hidden="true" /> Try again</> : <><Sparkles size={16} aria-hidden="true" /> Generate intelligence briefing</>}
      </button>
    </div>
  );
}
