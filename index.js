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

// ✅ Route Imports
import questRoutes from './routes/questRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import verifyRoutes from './routes/verifyRoutes.js';
import tonWebhook from './routes/tonWebhook.js';
import referralRoutes from './routes/referralRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import twitterRoutes from './routes/twitterRoutes.js';
import tokenSaleRoutes from './routes/tokenSaleRoutes.js';   // ⬅️ NEW

dotenv.config();
const app = express();

// 🔐 Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

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

// 🧭 Routes
app.use(questRoutes);
app.use(authRoutes);
app.use(userRoutes);
app.use(verifyRoutes);
app.use(tonWebhook);
app.use(referralRoutes);
app.use('/api/subscribe', subscriptionRoutes);
app.use('/api', twitterRoutes);
app.use(tokenSaleRoutes);                        // ⬅️ NEW mounts /token-sale/contribute

// 🧪 Health checks
app.get('/', (req, res) => res.send('7goldencowries backend is running'));
app.get('/session-debug', (req, res) => res.json({ session: req.session }));

// 🏆 Leaderboard route
app.get('/leaderboard', async (req, res) => {
  try {
    const users = await db.all(`
      SELECT wallet, twitterHandle, xp, tier
      FROM users
      ORDER BY xp DESC
      LIMIT 20
    `);

    const ranked = users.map((u, i) => {
      const level = getLevelInfo(u.xp || 0);
      const badgeSlug = level?.name
        ? `level-${level.name.toLowerCase().replace(/\s+/g, '-')}.png`
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

// ⏰ Subscription Expiry Cron
cron.schedule('0 0 * * *', async () => {
  console.log('🔄 Running daily subscription expiry check…');
  const now = dayjs().toISOString();

  try {
    const expired = await db.all(`
      SELECT id, wallet
      FROM subscriptions
      WHERE status = 'active'
        AND datetime(timestamp, '+30 days') <= ?
    `, now);

    for (const { id, wallet } of expired) {
      await db.run(`UPDATE users SET tier = 'Free' WHERE wallet = ?`, wallet);
      await db.run(`UPDATE subscriptions SET status = 'expired' WHERE id = ?`, id);
      console.log(` → Downgraded ${wallet}, sub#${id}`);
    }
  } catch (err) {
    console.error('❌ Cron error:', err);
  }
});

// 🚀 Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
