import express from 'express';
import passport from 'passport';
import db from '../db.js';

const router = express.Router();

// 🧠 Start Twitter OAuth — store wallet in session
router.get('/auth/twitter', (req, res, next) => {
  const encoded = req.query.state;
  if (!encoded) return res.status(400).send('Missing wallet state');

  req.session.state = encoded;
  req.session.save((err) => {
    if (err) return res.status(500).send('Session save failed');
    passport.authenticate('twitter')(req, res, next);
  });
});

// 🧠 Twitter callback — link wallet to Twitter handle
router.get(
  '/auth/twitter/callback',
  (req, res, next) => {
    passport.authenticate('twitter', { failureRedirect: '/' }, (err, user) => {
      if (err || !user) {
        console.error('❌ Twitter Auth Failed:', err);
        return res.redirect('/');
      }

      req.logIn(user, async (err) => {
        if (err) {
          console.error('❌ Login error after Twitter auth:', err);
          return res.redirect('/');
        }

        try {
          const twitterHandle = req.user?.username;
          const encoded = req.session?.state;

          if (!encoded) return res.status(400).send('Missing wallet state in session');

          let wallet;
          try {
            wallet = Buffer.from(encoded, 'base64').toString('utf-8');
          } catch (e) {
            return res.status(400).send('Invalid base64 wallet state');
          }

          if (!wallet || !twitterHandle) return res.status(400).send('Missing wallet or Twitter handle');

          const row = await db.get('SELECT * FROM users WHERE wallet = ?', wallet);

          if (row) {
            await db.run('UPDATE users SET twitterHandle = ? WHERE wallet = ?', twitterHandle, wallet);
          } else {
            await db.run(`
              INSERT INTO users (wallet, twitterHandle, xp, tier, levelName, levelProgress, nextXP)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, wallet, twitterHandle, 0, 'Free', 'Shellborn', 0, 10000);
          }

          return res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000/quests');
        } catch (err) {
          console.error('❌ Twitter callback error:', err);
          return res.status(500).send('Internal server error during Twitter linking');
        }
      });
    })(req, res, next);
  }
);

// 🔗 Manual Twitter linking
router.post('/link-twitter', async (req, res) => {
  const { wallet, twitter } = req.body;
  if (!wallet || !twitter) return res.status(400).json({ error: 'Missing wallet or twitter' });

  try {
    const row = await db.get('SELECT * FROM users WHERE wallet = ?', wallet);
    if (row) {
      await db.run('UPDATE users SET twitterHandle = ? WHERE wallet = ?', twitter, wallet);
    } else {
      await db.run(`
        INSERT INTO users (wallet, twitterHandle, xp, tier, levelName, levelProgress, nextXP)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, wallet, twitter, 0, 'Free', 'Shellborn', 0, 10000);
    }

    res.json({ message: 'Twitter handle linked' });
  } catch (err) {
    console.error('❌ Link Twitter error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 💰 Assign tier manually
router.post('/assign-tier', async (req, res) => {
  const { wallet, tier } = req.body;
  if (!wallet || !tier) return res.status(400).json({ error: 'Missing wallet or tier' });

  try {
    const row = await db.get('SELECT * FROM users WHERE wallet = ?', wallet);
    if (row) {
      await db.run('UPDATE users SET tier = ? WHERE wallet = ?', tier, wallet);
    } else {
      await db.run(`
        INSERT INTO users (wallet, tier, xp, levelName, levelProgress, nextXP)
        VALUES (?, ?, ?, ?, ?, ?)
      `, wallet, tier, 0, 'Shellborn', 0, 10000);
    }

    res.json({ message: `Tier '${tier}' assigned to ${wallet}` });
  } catch (err) {
    console.error('❌ Assign tier error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 💎 Update subscription tier
router.post('/set-subscription', async (req, res) => {
  const { wallet, tier } = req.body;
  if (!wallet || !tier) return res.status(400).json({ error: 'Missing wallet or tier' });

  try {
    const row = await db.get('SELECT * FROM users WHERE wallet = ?', wallet);
    if (!row) return res.status(404).json({ error: 'User not found' });

    await db.run('UPDATE users SET tier = ? WHERE wallet = ?', tier, wallet);
    res.json({ message: `Subscription updated to ${tier}` });
  } catch (err) {
    console.error('❌ Subscription update error:', err);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// 🐞 Debug
router.get('/session-debug', (req, res) => {
  res.json({ session: req.session });
});

export default router;
