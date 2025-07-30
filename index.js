// index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';
import MemoryStore from 'memorystore';
import cron from 'node-cron';
import dayjs from 'dayjs';

import './passport.js';
import db from './db.js';
import { getLevelInfo } from './utils/levelUtils.js';

import questRoutes from './routes/questRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import verifyRoutes from './routes/verifyRoutes.js';
import tonWebhook from './routes/tonWebhook.js';
import referralRoutes from './routes/referralRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import twitterRoutes from './routes/twitterRoutes.js';

dotenv.config();
const app = express();

// 🌐 CORS + JSON
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// 🧠 Sessions
const Store = MemoryStore(session);
app.use(session({
  secret: process.env.SESSION_SECRET || 'cowrie-secret',
  resave: false,
  saveUninitialized: true,
  store: new Store({ checkPeriod: 86400000 }),
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 3600000
  }
}));
app.use(passport.initialize());
app.use(passport.session());

// 🚀 Routes
app.use(questRoutes);
app.use(authRoutes);
app.use(userRoutes);
app.use(verifyRoutes);
app.use(tonWebhook);
app.use(referralRoutes);
app.use("/api/subscribe", subscriptionRoutes);
app.use("/api", twitterRoutes);

// 🧪 Health check
app.get('/', (req, res) => res.send('7goldencowries backend is running'));
app.get('/session-debug', (req, res) => res.json({ session: req.session }));

// 🏆 Leaderboard Route — FIXED!
app.get('/leaderboard', async (req, res) => {
  try {
    const users = db.prepare(`
      SELECT wallet, twitterHandle, xp, tier
      FROM users
      ORDER BY xp DESC
      LIMIT 20
    `).all();

    const ranked = users.map((u, i) => {
      const level = getLevelInfo(u.xp || 0);

      const badgeSlug = level?.name
        ? `level-${String(level.name).toLowerCase().replace(/\s+/g, '-')}.png`
        : 'unranked.png';

      return {
        rank: i + 1,
        wallet: u.wallet,
        twitter: u.twitterHandle || null,
        xp: u.xp,
        tier: u.tier || 'Free',
        name: level.name || 'Unranked',
        progress: level.progress || 0,
        badge: `/images/badges/${badgeSlug}`
      };
    });

    res.json({ top: ranked });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ⏰ Cron: expire subscriptions
cron.schedule('0 0 * * *', () => {
  console.log('🔄 Running daily subscription expiry check…');
  const now = dayjs().toISOString();

  const expired = db.prepare(`
    SELECT id, wallet
    FROM subscriptions
    WHERE status = 'active'
      AND datetime(timestamp, '+30 days') <= ?
  `).all(now);

  expired.forEach(({ id, wallet }) => {
    db.prepare(`UPDATE users SET tier = 'Free' WHERE wallet = ?`).run(wallet);
    db.prepare(`UPDATE subscriptions SET status = 'expired' WHERE id = ?`).run(id);
    console.log(` → Downgraded ${wallet}, sub#${id}`);
  });
});

// 🚀 Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
