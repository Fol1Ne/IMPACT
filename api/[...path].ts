import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app';

const app = createApp();

/** Vercel may hand the function `/health` or `/api/health`; Express always mounts at `/api`. */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? '/';
  if (!url.startsWith('/api')) req.url = url.startsWith('/') ? `/api${url}` : `/api/${url}`;
  app(req, res);
}
