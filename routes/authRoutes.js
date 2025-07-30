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

// 🧠 Twitter callback — link wallet to Twitter handle and create user if needed
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

          if (!encoded) {
            return res.status(400).send('Missing wallet state in session.');
          }

          let wallet;
          try {
            wallet = Buffer.from(encoded, 'base64').toString('utf-8');
          } catch (e) {
            return res.status(400).send('Invalid base64 wallet state.');
          }

          if (!wallet || !twitterHandle) {
            return res.status(400).send('Missing wallet or Twitter handle');
          }

          const row = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
          if (row) {
            db.prepare('UPDATE users SET twitterHandle = ? WHERE wallet = ?')
              .run(twitterHandle, wallet);
          } else {
            db.prepare(`
              INSERT INTO users (wallet, twitterHandle, xp, tier, levelName, levelProgress, nextXP)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(wallet, twitterHandle, 0, 'Free', 'Shellborn', 0, 100);
          }

          return res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000/quests');
        } catch (err) {
          console.error('❌ Twitter callback error:', err);
          return res.status(500).send('Internal server error during Twitter linking.');
        }
      });
    })(req, res, next);
  }
);

// 🔗 Manually link Twitter handle to wallet
router.post('/link-twitter', (req, res) => {
  const { wallet, twitter } = req.body;
  if (!wallet || !twitter) return res.status(400).json({ error: 'Missing wallet or twitter' });

  try {
    const row = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
    if (row) {
      db.prepare('UPDATE users SET twitterHandle = ? WHERE wallet = ?').run(twitter, wallet);
    } else {
      db.prepare(`
        INSERT INTO users (wallet, twitterHandle, xp, tier, levelName, levelProgress, nextXP)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(wallet, twitter, 0, 'Free', 'Shellborn', 0, 100);
    }

    res.json({ message: 'Twitter handle linked' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 💰 Assign user tier manually
router.post('/assign-tier', (req, res) => {
  const { wallet, tier } = req.body;
  if (!wallet || !tier) return res.status(400).json({ error: 'Missing wallet or tier' });

  try {
    const row = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
    if (row) {
      db.prepare('UPDATE users SET tier = ? WHERE wallet = ?').run(tier, wallet);
    } else {
      db.prepare(`
        INSERT INTO users (wallet, tier, xp, levelName, levelProgress, nextXP)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(wallet, tier, 0, 'Shellborn', 0, 100);
    }

    res.json({ message: `Tier '${tier}' assigned to ${wallet}` });
  } catch (err) {
    console.error('Assign tier error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 💎 Update user tier after TON subscription payment
router.post('/set-subscription', (req, res) => {
  const { wallet, tier } = req.body;
  if (!wallet || !tier) return res.status(400).json({ error: 'Missing wallet or tier' });

  try {
    const row = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
    if (!row) return res.status(404).json({ error: 'User not found' });

    db.prepare('UPDATE users SET tier = ? WHERE wallet = ?').run(tier, wallet);
    res.json({ message: `Subscription updated to ${tier}` });
  } catch (err) {
    console.error('Subscription update error:', err);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// 🐞 Debug session route
router.get('/session-debug', (req, res) => {
  res.json({ session: req.session });
});

export default router;
