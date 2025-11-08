import rateLimit from 'express-rate-limit';

export const rateLimitBindWallet = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,               // 5 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok:false, code:"too-many-requests", error:"Too many bind attempts. Try again shortly." }
});
