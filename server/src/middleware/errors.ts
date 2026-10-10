import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors';
import { log } from '../logger';

export const wrap = (fn: (...a: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res, next).catch(next); };

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route.' } });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err instanceof ZodError) return res.status(400).json({ error: { code: 'invalid_request', message: 'The request was not valid.' } });
  if ((err as { type?: string }).type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'Request body too large.' } });
  log('error', 'unhandled_error', { name: (err as Error)?.name, message: (err as Error)?.message });
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on the server.' } });
};
