// app.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import passport from 'passport';

import db from './lib/db.js';
import discordAuth from './routes/discordAuth.js';
import questRoutes from './routes/questRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import proofRoutes from './routes/proofRoutes.js';

const app = express();

/* ---------- CORS (Render ↔ Vercel with cookies) ---------- */
const defaultOrigin = 'https://7goldencowries.com';
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  process.env.FRONTEND_URL ||
  defaultOrigin
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow non-browser tools (no Origin) and any whitelisted origin
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

/* ---------- Core middlewares ---------- */
app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());

/* ---------- Sessions (cross-site, secure) ---------- */
// Required on Render/behind proxy so 'secure' cookies are set correctly
app.set('trust proxy', 1);

const isProd = process.env.NODE_ENV === 'production';

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-render',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,      // not readable by JS
    secure: isProd,      // HTTPS only in prod
    sameSite: isProd ? 'none' : 'lax',    // cross-site in prod, relaxed for localhost
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
}));

app.use(passport.initialize());
app.use(passport.session());

/* ---------- Health ---------- */
async function healthHandler(_req, res) {
  let dbStatus = 'ok';
  try {
    await db.get('SELECT 1');
  } catch {
    dbStatus = 'down';
  }
  res.json({ ok: true, db: dbStatus });
}

app.get('/api/health', healthHandler);
app.get('/health', healthHandler); // alias
app.get('/healthz', healthHandler);

/* ---------- Session-based profile: /api/users/me ---------- */
/*  Frontend can call this without passing wallet; it reads the session user.
    Adjust the fields to match what your strategies store on req.user / req.session. */
app.get('/api/users/me', async (req, res) => {
  try {
    // Prefer req.user (passport), fallback to whatever you saved in session
    const sess = req.user || req.session?.user || {};
    const wallet = sess.wallet || req.session?.wallet || null;

    if (!wallet) {
      return res.json({
        authed: false,
        profile: null,
      });
    }

    const user = await db.get(
      `SELECT wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP,
              twitterHandle, telegramHandle, discordHandle
         FROM users WHERE wallet = ?`,
      wallet
    );

    if (!user) {
      return res.json({
        authed: true,
        profile: {
          wallet,
          xp: 0,
          tier: 'Free',
          levelName: 'Shellborn',
          levelSymbol: '🐚',
          levelProgress: 0,
          nextXP: 10000,
          links: { twitter: null, telegram: null, discord: null },
        },
        history: [],
      });
    }

    const links = {
      twitter: user.twitterHandle || null,
      telegram: user.telegramHandle || null,
      discord: user.discordHandle || null,
    };

    const profile = {
      wallet: user.wallet,
      xp: user.xp ?? 0,
      tier: user.tier || 'Free',
      levelName: user.levelName || 'Shellborn',
      levelSymbol: user.levelSymbol || '🐚',
      levelProgress: user.levelProgress ?? 0,
      nextXP: user.nextXP ?? 10000,
      links,
    };

    const history = await db.all(
      `SELECT c.quest_id AS id, q.title, q.xp, c.timestamp
         FROM completed_quests c
         JOIN quests q ON q.id = c.quest_id
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 200`,
      wallet
    );

    res.json({ authed: true, profile, history: history || [] });
  } catch (e) {
    console.error('users/me error:', e);
    res.status(500).json({ error: 'Failed to load session profile' });
  }
});

/* ---------- Wallet-query profile (kept from your version) ---------- */
app.get('/api/profile', async (req, res) => {
  try {
    const wallet = String(req.query.wallet || '').trim();
    if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

    const user = await db.get(
      `SELECT wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP,
              twitterHandle, telegramHandle, discordHandle
         FROM users WHERE wallet = ?`,
      wallet
    );

    if (!user) {
      return res.json({
        profile: {
          wallet,
          xp: 0,
          tier: 'Free',
          levelName: 'Shellborn',
          levelSymbol: '🐚',
          levelProgress: 0,
          nextXP: 10000,
          links: { twitter: null, telegram: null, discord: null },
        },
        history: [],
      });
    }

    const links = {
      twitter: user.twitterHandle || null,
      telegram: user.telegramHandle || null,
      discord: user.discordHandle || null,
    };

    const profile = {
      wallet: user.wallet,
      xp: user.xp ?? 0,
      tier: user.tier || 'Free',
      levelName: user.levelName || 'Shellborn',
      levelSymbol: user.levelSymbol || '🐚',
      levelProgress: user.levelProgress ?? 0,
      nextXP: user.nextXP ?? 10000,
      links,
    };

    const history = await db.all(
      `SELECT c.quest_id AS id, q.title, q.xp, c.timestamp
         FROM completed_quests c
         JOIN quests q ON q.id = c.quest_id
        WHERE c.wallet = ?
        ORDER BY c.timestamp DESC
        LIMIT 200`,
      wallet
    );

    res.json({ profile, history: history || [] });
  } catch (e) {
    console.error('profile error:', e);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

/* ---------- Routes ---------- */
app.use('/auth', discordAuth);
app.use('/api/quest', questRoutes);
app.use('/api/proofs', proofRoutes);
app.use('/api/admin', adminRoutes); // seeding utilities

/* ---------- Start ---------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`7GC backend listening on :${PORT}`);
});
