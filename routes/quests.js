import { Router } from "express";
import db from "../lib/db.js";

const router = Router();

async function ensureQuestSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS quests(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      xp INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'oneoff',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS quest_completions(
      wallet TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      proof TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY(wallet, quest_id)
    );

    CREATE TABLE IF NOT EXISTS users(
      wallet TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leaderboard_scores(
      address TEXT PRIMARY KEY,
      score   INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function seedQuestsOnce() {
  const row = await db.get(`SELECT COUNT(*) AS c FROM quests;`);
  if ((row?.c ?? 0) > 0) return;
  // Minimal seed (extend later in the DB, FE reads from API)
  await db.exec(`
    INSERT INTO quests(id, title, description, xp, kind, active) VALUES
      ('onboarding_connect_wallet','Connect your TON wallet','Link your wallet to begin your journey',50,'oneoff',1),
      ('join_community','Join the community','Join our Telegram/Discord to get updates',50,'oneoff',1),
      ('daily_checkin','Daily check-in','Return daily to earn XP',10,'daily',1),
      ('share_referral','Share your referral link','Invite a friend using your link',25,'referral',1);
  `);
}

function normalizeAddress(a) {
  const s = String(a || "").trim();
  return s.length ? s : null;
}

async function awardXp(wallet, delta) {
  const addr = normalizeAddress(wallet);
  const inc  = Number.isFinite(+delta) ? +delta : 0;
  if (!addr || inc <= 0) return;

  await db.exec("BEGIN;");
  await db.run(`INSERT OR IGNORE INTO users(wallet, xp) VALUES(?, 0);`, addr);

  const u = await db.get(`SELECT xp FROM users WHERE wallet=?;`, addr);
  if (u) {
    await db.run(`UPDATE users SET xp = xp + ? WHERE wallet = ?;`, inc, addr);
  } else {
    await db.run(`INSERT INTO users(wallet, xp) VALUES(?, ?);`, addr, inc);
  }

  const l = await db.get(`SELECT score FROM leaderboard_scores WHERE address=?;`, addr);
  if (l) {
    await db.run(`UPDATE leaderboard_scores SET score = score + ? WHERE address = ?;`, inc, addr);
  } else {
    await db.run(`INSERT INTO leaderboard_scores(address, score) VALUES(?, ?);`, addr, inc);
  }
  await db.exec("COMMIT;");
}

router.get("/", async (_req, res) => {
  try {
    await ensureQuestSchema();
    await seedQuestsOnce();
    const rows = await db.all(
      `SELECT id, title, description, xp, kind, active
         FROM quests
        WHERE active = 1
        ORDER BY CASE kind
                   WHEN 'daily' THEN 0
                   WHEN 'oneoff' THEN 1
                   WHEN 'referral' THEN 2
                   ELSE 99
                 END, rowid ASC;`
    );

    // multi-shape compat for FE
    res.json({ ok: true, results: rows, rows, items: rows, quests: rows });
  } catch (e) {
    console.error("quests list error:", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/claim", async (req, res) => {
  try {
    const wallet = normalizeAddress(req?.session?.wallet);
    if (!wallet) return res.status(401).json({ ok: false, error: "not_authed" });

    const { id, proof } = req.body || {};
    const qid = String(id || "").trim();
    if (!qid) return res.status(400).json({ ok: false, error: "bad_request" });

    await ensureQuestSchema();

    const quest = await db.get(`SELECT id, xp, kind, active FROM quests WHERE id=?;`, qid);
    if (!quest || !quest.active) return res.status(404).json({ ok: false, error: "quest_not_found" });

    // one claim per wallet per quest (MVP)
    const existing = await db.get(
      `SELECT 1 FROM quest_completions WHERE wallet=? AND quest_id=?;`,
      wallet, qid
    );
    if (existing) return res.json({ ok: true, claimed: false, message: "already_claimed" });

    await db.exec("BEGIN;");
    await db.run(
      `INSERT INTO quest_completions(wallet, quest_id, proof) VALUES(?,?,?);`,
      wallet, qid, proof ? String(proof).slice(0,1024) : null
    );
    await db.exec("COMMIT;");

    await awardXp(wallet, quest.xp);

    res.json({ ok: true, claimed: true, questId: qid, xpAwarded: quest.xp });
  } catch (e) {
    try { await db.exec("ROLLBACK;"); } catch {}
    console.error("quests claim error:", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
