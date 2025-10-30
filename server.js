const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const fetch = require('node-fetch');
const { getDB } = require('./db');
const { isFollowing, hasRetweeted, hasQuoted } = require('./routes/twitterVerify');

const app = express();
app.use(express.json());

const ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ORIGINS.includes(origin)),
  credentials: true
}));

app.set('trust proxy', 1);
app.use(session({
  name: '7gc.sid',
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax', secure: false, maxAge: 1000*60*60*24*30 },
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: '.' })
}));

// --- DB schema + seeds ---
async function ensureSchemaAndSeeds() {
  const db = await getDB();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      wallet TEXT UNIQUE,
      twitterHandle TEXT,
      xp INTEGER DEFAULT 0,
      levelName TEXT DEFAULT 'Shellborn'
    );
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,        -- 'twitter_follow' | 'twitter_retweet' | 'twitter_quote'
      meta TEXT NOT NULL,        -- JSON (targets)
      xp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quest_completions (
      id INTEGER PRIMARY KEY,
      wallet TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(wallet, quest_id)
    );
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY,
      code TEXT UNIQUE,
      inviter_wallet TEXT,
      invitee_wallet TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const row = await db.get(`SELECT COUNT(*) as c FROM quests;`);
  if (!row || row.c === 0) {
    // Seed 3 Twitter quests (uses your pinned tweet id)
    const data = [
      { id:'tw_follow',  title:'Follow @7goldencowries', category:'social', type:'twitter_follow', meta: JSON.stringify({target:'7goldencowries'}), xp:1500 },
      { id:'tw_rt_pin',  title:'Retweet the pinned tweet', category:'social', type:'twitter_retweet', meta: JSON.stringify({tweetId:'1947595024117502145'}), xp:2000 },
      { id:'tw_quote',   title:'Quote the pinned tweet',   category:'social', type:'twitter_quote',  meta: JSON.stringify({tweetId:'1947595024117502145'}), xp:3000 }
    ];
    const stmt = await db.prepare(`INSERT INTO quests(id,title,category,type,meta,xp) VALUES (?,?,?,?,?,?)`);
    for (const q of data) await stmt.run(q.id, q.title, q.category, q.type, q.meta, q.xp);
    await stmt.finalize();
  }
}
ensureSchemaAndSeeds().catch(console.error);

// --- Auth: bind wallet to session (already existed; keep endpoint stable) ---
app.post('/api/auth/wallet/session', async (req, res) => {
  try {
    const { address, twitterHandle } = req.body || {};
    if (!address) return res.status(400).json({ ok:false, error:'wallet required' });
    req.session.wallet = address;

    const db = await getDB();
    await db.run(`INSERT INTO users(wallet, twitterHandle) VALUES(?, ?)
                  ON CONFLICT(wallet) DO UPDATE SET twitterHandle=COALESCE(?, users.twitterHandle)`,
                  address, twitterHandle || null, twitterHandle || null);
    res.json({ ok:true, wallet:address });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, error:'server' });
  }
});

// Debug me
app.get('/api/me', async (req,res) => {
  if (!req.session.wallet) return res.json({ ok:true, wallet:null });
  const db = await getDB();
  const me = await db.get(`SELECT wallet, twitterHandle, xp, levelName FROM users WHERE wallet=?`, req.session.wallet);
  res.json({ ok:true, ...me });
});

// --- Quests ---
app.get('/api/quests', async (req,res) => {
  const db = await getDB();
  const list = await db.all(`SELECT id,title,category,type,meta,xp FROM quests ORDER BY category, id`);
  // group by category
  const byCat = list.reduce((m,q) => {
    (m[q.category] ||= []).push(q);
    return m;
  }, {});
  res.json({ ok:true, categories: byCat });
});

async function verifyQuest(wallet, quest) {
  // Need the user's twitter handle
  const db = await getDB();
  const row = await db.get(`SELECT twitterHandle FROM users WHERE wallet=?`, wallet);
  const handle = row?.twitterHandle;
  if (!handle) return { ok:false, reason:'link_twitter' };

  const meta = JSON.parse(quest.meta || '{}');
  if (quest.type === 'twitter_follow') {
    const ok = await isFollowing(handle, meta.target);
    return ok ? { ok:true } : { ok:false, reason:'not_following' };
  }
  if (quest.type === 'twitter_retweet') {
    const ok = await hasRetweeted(handle, meta.tweetId);
    return ok ? { ok:true } : { ok:false, reason:'no_retweet' };
  }
  if (quest.type === 'twitter_quote') {
    const ok = await hasQuoted(handle, meta.tweetId);
    return ok ? { ok:true } : { ok:false, reason:'no_quote' };
  }
  return { ok:false, reason:'unknown_type' };
}

app.post('/api/quests/claim', async (req,res) => {
  try {
    if (!req.session.wallet) return res.status(401).json({ ok:false, error:'no_session' });
    const { questId } = req.body || {};
    if (!questId) return res.status(400).json({ ok:false, error:'questId required' });

    const db = await getDB();
    const quest = await db.get(`SELECT * FROM quests WHERE id=?`, questId);
    if (!quest) return res.status(404).json({ ok:false, error:'not_found' });

    // already completed?
    const done = await db.get(`SELECT 1 FROM quest_completions WHERE wallet=? AND quest_id=?`, req.session.wallet, questId);
    if (done) return res.json({ ok:true, already:true });

    // live verification
    const vr = await verifyQuest(req.session.wallet, quest);
    if (!vr.ok) return res.status(400).json({ ok:false, error:vr.reason });

    await db.run(`INSERT INTO quest_completions(wallet, quest_id) VALUES(?, ?)`, req.session.wallet, questId);
    await db.run(`UPDATE users SET xp = xp + ? WHERE wallet=?`, quest.xp, req.session.wallet);
    const me = await db.get(`SELECT wallet,xp,levelName,twitterHandle FROM users WHERE wallet=?`, req.session.wallet);
    res.json({ ok:true, claimed:true, xpAwarded: quest.xp, me });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, error:'server' });
  }
});

// --- Profile & Leaderboard ---
app.get('/api/profile', async (req,res) => {
  if (!req.session.wallet) return res.status(401).json({ ok:false, error:'no_session' });
  const db = await getDB();
  const me = await db.get(`SELECT wallet, twitterHandle, xp, levelName FROM users WHERE wallet=?`, req.session.wallet);
  const completed = await db.all(`SELECT quest_id, created_at FROM quest_completions WHERE wallet=? ORDER BY created_at DESC`, req.session.wallet);
  res.json({ ok:true, me, completed });
});

app.get('/api/leaderboard', async (req,res) => {
  const db = await getDB();
  const top = await db.all(`SELECT wallet, twitterHandle, xp FROM users ORDER BY xp DESC LIMIT 100`);
  res.json({ ok:true, top });
});

// --- Referrals (simple, live) ---
function makeCode(wallet){ return Buffer.from(wallet).toString('base64').slice(0,10); }

app.get('/api/referrals/me', async (req,res) => {
  if (!req.session.wallet) return res.status(401).json({ ok:false, error:'no_session' });
  const db = await getDB();
  const code = makeCode(req.session.wallet);
  const invited = await db.all(`SELECT invitee_wallet FROM referrals WHERE inviter_wallet=?`, req.session.wallet);
  res.json({ ok:true, code, invitedCount: invited.length });
});

app.post('/api/referrals/claim', async (req,res) => {
  if (!req.session.wallet) return res.status(401).json({ ok:false, error:'no_session' });
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ ok:false, error:'code_required' });
  const inviter = Buffer.from(code + '==', 'base64').toString().replace(/[^A-Za-z0-9_\-:.]/g,'');
  if (inviter === req.session.wallet) return res.status(400).json({ ok:false, error:'self' });

  const db = await getDB();
  const exists = await db.get(`SELECT 1 FROM referrals WHERE invitee_wallet=?`, req.session.wallet);
  if (!exists) {
    await db.run(`INSERT INTO referrals(code,inviter_wallet,invitee_wallet) VALUES(?,?,?)`,
      code, inviter, req.session.wallet);
    // award XP both sides
    await db.run(`UPDATE users SET xp = xp + 1500 WHERE wallet IN (?,?)`, inviter, req.session.wallet);
  }
  res.json({ ok:true });
});

// health
app.get('/api/health', (req,res)=> res.json({ ok:true, ts: Date.now() }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log('Listening on', PORT));
