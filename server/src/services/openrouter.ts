import { getConfig } from '../config';
import { HttpError } from '../errors';
import { log } from '../logger';

export type ChatMessage = { role: 'system' | 'user'; content: string };

/** Statuses after which the same request may succeed on another model: no credits, model gone, upstream rate limit or outage. */
const TRY_NEXT_MODEL = new Set([402, 404, 429, 502, 503]);

function statusError(status: number, model: string): HttpError {
  if (status === 401 || status === 403) return new HttpError(502, 'ai_auth_failed', 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY.');
  if (status === 402) return new HttpError(502, 'ai_no_credits', 'The OpenRouter account has no credits for the configured model. Add credits or set OPENROUTER_FALLBACK_MODEL to free models.');
  if (status === 429) return new HttpError(429, 'ai_rate_limited', 'OpenRouter rate limit reached. Wait a moment and retry.');
  log('warn', 'openrouter_bad_status', { status, model });
  return new HttpError(502, 'ai_upstream_error', `OpenRouter returned an error (${status}). The configured model may be unavailable - check OPENROUTER_MODEL.`);
}

/**
 * One chat completion. Returns the raw text content; maps every failure to a safe HttpError.
 * Models are tried in order (OPENROUTER_MODEL, then each OPENROUTER_FALLBACK_MODEL) while the failure is one another model could avoid.
 */
export async function chatCompletion(messages: ChatMessage[], opts: { maxTokens: number; fetchImpl?: typeof fetch }): Promise<{ content: string; model: string }> {
  const cfg = getConfig();
  if (!cfg.openrouter.apiKey) throw new HttpError(503, 'ai_not_configured', 'AI features need an OpenRouter API key. Set OPENROUTER_API_KEY in .env and restart the server.');
  const f = opts.fetchImpl ?? fetch;
  const fallbacks = cfg.openrouter.fallbackModel.split(',').map((m) => m.trim()).filter(Boolean);
  const models = [...new Set([cfg.openrouter.model, ...fallbacks])];

  let lastError: HttpError | null = null;
  for (const [i, model] of models.entries()) {
    const last = i === models.length - 1;
    let res: Response;
    try {
      res = await f('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.openrouter.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': cfg.clientUrl, 'X-Title': 'IMPACT' },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: opts.maxTokens }),
        signal: AbortSignal.timeout(cfg.openrouter.timeoutMs),
      });
    } catch (err) {
      const timeout = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      log('warn', 'openrouter_request_failed', { reason: (err as Error).name, model });
      throw new HttpError(timeout ? 504 : 502, timeout ? 'ai_timeout' : 'ai_unreachable', timeout ? 'The AI model took too long to respond. Try again.' : 'Could not reach OpenRouter. Check your connection and try again.');
    }
    if (!res.ok) {
      lastError = statusError(res.status, model);
      if (TRY_NEXT_MODEL.has(res.status) && !last) { log('warn', 'openrouter_model_unusable', { status: res.status, model }); continue; }
      throw lastError;
    }
    let content: unknown;
    try {
      const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      content = json.choices?.[0]?.message?.content;
    } catch {
      content = null;
    }
    if (typeof content === 'string' && content.trim()) return { content, model };
    lastError = new HttpError(502, 'bad_model_output', 'The AI model returned an empty response. Please try again.');
    if (!last) { log('warn', 'openrouter_empty_content', { model }); continue; }
  }
  throw lastError ?? new HttpError(502, 'ai_upstream_error', 'No AI model is configured.');
}

/** Pull a JSON object out of model text that may be fenced or wrapped in prose. */
export function extractJson(raw: string): unknown {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!text.startsWith('{')) {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a !== -1 && b > a) text = text.slice(a, b + 1);
  }
  return JSON.parse(text);
}
