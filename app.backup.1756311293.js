import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import db from './db.js';
import discordAuth from './routes/discordAuth.js';
import questRoutes from './routes/questRoutes.js';

const app = express();

/* ---------- CORS ---------- */
const allowed = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow same-origin / curl (no origin) and any explicitly allowed origins
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

/* ---------- Middlewares ---------- */
app.use(express.json());
app.use(morgan('dev'));

/* ---------- Health ---------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/* ---------- Profile (used by frontend) ----------
   GET /api/profile?wallet=EQxxxx
   Returns: { profile: {...}, history: [...] }
*/
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

    // Default empty profile if user not found yet
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
      `SELECT c.questId AS id, q.title, q.xp, c.timestamp
         FROM completed_quests c
         JOIN quests q ON q.id = c.questId
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
app.use('/auth', discordAuth);      // /auth/discord, /auth/discord/callback
app.use('/api/quest', questRoutes); // /api/quest/quests, /completed/:wallet, /complete

/* ---------- Start ---------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`7GC backend listening on :${PORT}`);
});
