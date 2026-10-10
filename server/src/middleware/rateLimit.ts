import rateLimit from 'express-rate-limit';

const make = (max: number) => rateLimit({
  windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.' } }); },
});
export const aiLimiter = make(10);
export const checkoutLimiter = make(10);
export const newsLimiter = make(30);
export const smsLimiter = make(5);
export const generalLimiter = make(120);
