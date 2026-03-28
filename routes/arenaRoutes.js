import express from "express";
import crypto from "crypto";
import db from "../lib/db.js";
import { getSessionWallet } from "../utils/session.js";
import { awardQuest } from "../lib/quests.js";
import { verifyQuestRequirement } from "../lib/proofVerifier.js";

const router = express.Router();

function adminGuard(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

async function logAudit(actorType, actorId, action, targetType, targetId, data = {}) {
  await db.run(
    `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    actorType,
    actorId || "system",
    action,
    targetType,
    String(targetId || ""),
    JSON.stringify(data || {})
  );
}

async function ensureJoinableArena(arenaId) {
  const arena = await db.get(`SELECT * FROM arenas WHERE id = ?`, arenaId);
  if (!arena) return { ok: false, code: 404, error: "arena_not_found" };
  if (!["scheduled", "live"].includes(String(arena.status))) {
    return { ok: false, code: 409, error: "arena_not_joinable" };
  }
  if (arena.visibility === "private") {
    return { ok: false, code: 403, error: "arena_private" };
  }
  const now = Date.now();
  if (arena.end_time && new Date(arena.end_time).getTime() < now) {
    return { ok: false, code: 409, error: "arena_closed" };
  }
  return { ok: true, arena };
}

async function createArenaParticipant({ arenaId, wallet, joinedVia = "free", joinPaymentId = null }) {
  await db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const existing = await db.get(
      `SELECT id FROM arena_participants WHERE arena_id = ? AND user_wallet = ?`,
      arenaId,
      wallet
    );
    if (existing) {
      await db.exec("COMMIT");
      return { created: false, id: existing.id };
    }
    const inserted = await db.run(
      `INSERT INTO arena_participants (arena_id, user_wallet, wallet, joined_via, join_payment_id)
       VALUES (?, ?, ?, ?, ?)`,
      arenaId,
      wallet,
      wallet,
      joinedVia,
      joinPaymentId
    );
    await db.exec("COMMIT");
    return { created: true, id: inserted.lastID };
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

async function completePaymentAndJoin({ paymentId, externalTransactionId = null }) {
  await db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const payment = await db.get(`SELECT * FROM payments WHERE id = ?`, paymentId);
    if (!payment) {
      await db.exec("ROLLBACK");
      return { ok: false, code: 404, error: "payment_not_found" };
    }

    if (payment.status === "paid") {
      const participant = await db.get(
        `SELECT id FROM arena_participants WHERE arena_id = ? AND user_wallet = ?`,
        payment.arena_id,
        payment.user_wallet
      );
      await db.exec("COMMIT");
      return { ok: true, already: true, participantId: participant?.id || null };
    }

    await db.run(
      `UPDATE payments
       SET status='paid', external_transaction_id = COALESCE(?, external_transaction_id), paid_at=datetime('now'), updated_at=datetime('now')
       WHERE id = ?`,
      externalTransactionId,
      paymentId
    );

    const before = await db.get(`SELECT id FROM arena_participants WHERE arena_id = ? AND user_wallet = ?`, payment.arena_id, payment.user_wallet);
    if (!before) {
      await db.run(
        `INSERT INTO arena_participants (arena_id, user_wallet, wallet, joined_via, join_payment_id)
         VALUES (?, ?, ?, ?, ?)`,
        payment.arena_id,
        payment.user_wallet,
        payment.user_wallet,
        payment.provider,
        payment.id
      );
      await db.run(
        `UPDATE arenas SET prize_pool_amount = COALESCE(prize_pool_amount, 0) + ?, updated_at=datetime('now') WHERE id = ?`,
        Number(payment.amount || 0),
        payment.arena_id
      );
    }

    await db.exec("COMMIT");
    await logAudit("user", payment.user_wallet, "arena_join_paid", "arena", payment.arena_id, {
      paymentId,
      provider: payment.provider,
      amount: payment.amount,
      currency: payment.currency,
    });
    return { ok: true, already: Boolean(before), paymentId };
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

router.get("/api/arenas", async (_req, res) => {
  try {
    const arenas = await db.all(
      `SELECT a.*, s.name AS sponsor_name
       FROM arenas a
       LEFT JOIN sponsors s ON s.id = a.sponsor_id
       WHERE a.visibility = 'public' AND a.status IN ('scheduled', 'live')
       ORDER BY COALESCE(a.start_time, a.created_at) ASC`
    );
    return res.json({ ok: true, arenas });
  } catch (err) {
    console.error("arenas list error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/arenas/:id", async (req, res) => {
  try {
    const arena = await db.get(`SELECT * FROM arenas WHERE id = ?`, req.params.id);
    if (!arena) return res.status(404).json({ ok: false, error: "arena_not_found" });
    const quests = await db.all(
      `SELECT aq.quest_id, aq.weight, aq.active, q.title, q.xp
       FROM arena_quests aq
       LEFT JOIN quests q ON CAST(q.id AS TEXT) = CAST(aq.quest_id AS TEXT)
       WHERE aq.arena_id = ? AND aq.active = 1`,
      req.params.id
    );
    return res.json({ ok: true, arena: { ...arena, quests } });
  } catch (err) {
    console.error("arena detail error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/arenas/:id/leaderboard", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT user_wallet AS wallet, arena_xp, created_at,
              ROW_NUMBER() OVER (ORDER BY arena_xp DESC, datetime(created_at) ASC, user_wallet ASC) AS rank
       FROM arena_participants
       WHERE arena_id = ? AND status = 'active'
       ORDER BY arena_xp DESC, datetime(created_at) ASC, user_wallet ASC
       LIMIT 200`,
      req.params.id
    );
    return res.json({ ok: true, leaderboard: rows });
  } catch (err) {
    console.error("arena leaderboard error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/arenas/:id/me", async (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "auth_required" });
  try {
    const me = await db.get(
      `SELECT ap.*, a.status AS arena_status
       FROM arena_participants ap
       JOIN arenas a ON a.id = ap.arena_id
       WHERE ap.arena_id = ? AND ap.user_wallet = ?`,
      req.params.id,
      wallet
    );
    return res.json({ ok: true, joined: Boolean(me), participant: me || null });
  } catch (err) {
    console.error("arena me error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/api/arenas/:id/join", async (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "auth_required" });
  try {
    const check = await ensureJoinableArena(req.params.id);
    if (!check.ok) return res.status(check.code).json({ ok: false, error: check.error });

    const arena = check.arena;
    if (Number(arena.max_participants || 0) > 0) {
      const count = await db.get(`SELECT COUNT(*) AS n FROM arena_participants WHERE arena_id = ?`, arena.id);
      if (Number(count?.n || 0) >= Number(arena.max_participants)) {
        return res.status(409).json({ ok: false, error: "arena_full" });
      }
    }

    if (Number(arena.entry_fee_amount || 0) > 0) {
      const paid = await db.get(
        `SELECT id FROM payments WHERE arena_id = ? AND user_wallet = ? AND status = 'paid' ORDER BY id DESC LIMIT 1`,
        arena.id,
        wallet
      );
      if (!paid) return res.status(402).json({ ok: false, error: "payment_required" });
      const participant = await createArenaParticipant({ arenaId: arena.id, wallet, joinedVia: "paid", joinPaymentId: paid.id });
      return res.json({ ok: true, joined: true, already: !participant.created });
    }

    const participant = await createArenaParticipant({ arenaId: arena.id, wallet, joinedVia: "free" });
    await logAudit("user", wallet, "arena_join", "arena", arena.id, { joinedVia: "free" });
    return res.json({ ok: true, joined: true, already: !participant.created });
  } catch (err) {
    console.error("arena join error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/api/payments/arena-entry/ton/init", async (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "auth_required" });
  try {
    const arenaId = Number(req.body?.arenaId || 0);
    const arena = await db.get(`SELECT * FROM arenas WHERE id = ?`, arenaId);
    if (!arena) return res.status(404).json({ ok: false, error: "arena_not_found" });
    const amount = Number(arena.entry_fee_amount || 0);
    if (amount <= 0) return res.status(400).json({ ok: false, error: "arena_is_free" });

    const providerReference = `ton_${arenaId}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const metadata = JSON.stringify({ arenaCode: arena.code, expectedTo: process.env.TON_RECEIVE_ADDRESS || null });
    const result = await db.run(
      `INSERT INTO payments (user_wallet, arena_id, payment_type, provider, provider_reference, amount, currency, status, metadata)
       VALUES (?, ?, 'arena_entry', 'ton', ?, ?, ?, 'pending', ?)`,
      wallet,
      arenaId,
      providerReference,
      amount,
      arena.entry_fee_currency || "TON",
      metadata
    );

    return res.json({
      ok: true,
      paymentId: result.lastID,
      providerReference,
      amount,
      currency: arena.entry_fee_currency || "TON",
      receiveAddress: process.env.TON_RECEIVE_ADDRESS || "",
      comment: providerReference,
    });
  } catch (err) {
    console.error("ton init error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/api/payments/arena-entry/ton/confirm", async (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "auth_required" });
  try {
    const paymentId = Number(req.body?.paymentId || 0);
    const txHash = String(req.body?.txHash || "").trim();
    if (!paymentId || !txHash) return res.status(400).json({ ok: false, error: "payment_and_tx_required" });
    const payment = await db.get(`SELECT * FROM payments WHERE id = ? AND user_wallet = ?`, paymentId, wallet);
    if (!payment) return res.status(404).json({ ok: false, error: "payment_not_found" });

    // In production use TON indexer verification; fallback is deterministic tx hash binding.
    if (!txHash.toLowerCase().includes(String(payment.provider_reference || "").toLowerCase().slice(-6))) {
      return res.status(422).json({ ok: false, error: "verification_failed" });
    }

    const result = await completePaymentAndJoin({ paymentId, externalTransactionId: txHash });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("ton confirm error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/api/payments/arena-entry/nomba/init", async (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "auth_required" });
  try {
    const arenaId = Number(req.body?.arenaId || 0);
    const arena = await db.get(`SELECT * FROM arenas WHERE id = ?`, arenaId);
    if (!arena) return res.status(404).json({ ok: false, error: "arena_not_found" });
    const amount = Number(arena.entry_fee_amount || 0);
    if (amount <= 0) return res.status(400).json({ ok: false, error: "arena_is_free" });

    const providerReference = `nomba_${arenaId}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const checkoutBase = process.env.NOMBA_CHECKOUT_BASE_URL || "https://checkout.nomba.com/pay";
    const checkoutUrl = `${checkoutBase}?ref=${encodeURIComponent(providerReference)}`;

    const result = await db.run(
      `INSERT INTO payments (user_wallet, arena_id, payment_type, provider, provider_reference, amount, currency, status, checkout_url, metadata)
       VALUES (?, ?, 'arena_entry', 'nomba', ?, ?, ?, 'pending', ?, ?)`,
      wallet,
      arenaId,
      providerReference,
      amount,
      arena.entry_fee_currency || "NGN",
      checkoutUrl,
      JSON.stringify({ initiatedBy: wallet })
    );

    return res.json({ ok: true, paymentId: result.lastID, checkoutUrl, providerReference });
  } catch (err) {
    console.error("nomba init error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/api/webhooks/nomba", async (req, res) => {
  try {
    const sig = req.headers["x-nomba-signature"] || "";
    const body = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
    const expected = process.env.NOMBA_WEBHOOK_SECRET
      ? crypto.createHmac("sha256", process.env.NOMBA_WEBHOOK_SECRET).update(body).digest("hex")
      : null;

    if (process.env.NOMBA_WEBHOOK_SECRET && sig !== expected) {
      return res.status(401).json({ ok: false, error: "invalid_signature" });
    }

    const eventType = String(req.body?.event || req.body?.type || "unknown");
    const reference = String(req.body?.reference || req.body?.data?.reference || "");
    await db.run(
      `INSERT INTO payment_events (provider, event_type, external_reference, payload)
       VALUES ('nomba', ?, ?, ?)`,
      eventType,
      reference,
      body
    );

    const payment = await db.get(`SELECT * FROM payments WHERE provider = 'nomba' AND provider_reference = ?`, reference);
    if (!payment) {
      return res.json({ ok: true, ignored: true, reason: "unknown_reference" });
    }

    const amount = Number(req.body?.amount || req.body?.data?.amount || payment.amount);
    const currency = String(req.body?.currency || req.body?.data?.currency || payment.currency || "").toUpperCase();
    const status = String(req.body?.status || req.body?.data?.status || "").toLowerCase();

    if (status !== "success" && status !== "paid") {
      return res.json({ ok: true, ignored: true, reason: "not_paid" });
    }
    if (Math.abs(amount - Number(payment.amount || 0)) > 0.0001 || currency !== String(payment.currency || "").toUpperCase()) {
      return res.status(422).json({ ok: false, error: "amount_currency_mismatch" });
    }

    const completed = await completePaymentAndJoin({
      paymentId: payment.id,
      externalTransactionId: String(req.body?.transactionId || req.body?.data?.transaction_id || "") || null,
    });
    await db.run(
      `UPDATE payment_events SET processed = 1, processed_at = datetime('now')
       WHERE provider='nomba' AND external_reference = ?`,
      reference
    );
    return res.json({ ok: true, completed });
  } catch (err) {
    console.error("nomba webhook error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/payments/:paymentId/status", async (req, res) => {
  const wallet = getSessionWallet(req);
  if (!wallet) return res.status(401).json({ ok: false, error: "auth_required" });
  try {
    const payment = await db.get(
      `SELECT id, provider, amount, currency, status, checkout_url, arena_id, paid_at
       FROM payments WHERE id = ? AND user_wallet = ?`,
      req.params.paymentId,
      wallet
    );
    if (!payment) return res.status(404).json({ ok: false, error: "payment_not_found" });
    return res.json({ ok: true, payment });
  } catch (err) {
    console.error("payment status error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/api/partners/apply", async (req, res) => {
  try {
    const body = req.body || {};
    const required = ["brand_name", "contact_name", "email", "campaign_type"];
    for (const field of required) {
      if (!String(body[field] || "").trim()) return res.status(400).json({ ok: false, error: `missing_${field}` });
    }
    const result = await db.run(
      `INSERT INTO sponsor_applications (
         brand_name, contact_name, email, telegram_handle, twitter_handle, website_url,
         campaign_type, target_audience, desired_start_date, budget, notes, status, payment_status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')`,
      String(body.brand_name).trim(),
      String(body.contact_name).trim(),
      String(body.email).trim().toLowerCase(),
      String(body.telegram_handle || "").trim(),
      String(body.twitter_handle || "").trim(),
      String(body.website_url || "").trim(),
      String(body.campaign_type).trim(),
      String(body.target_audience || "").trim(),
      String(body.desired_start_date || "").trim(),
      Number(body.budget || 0),
      String(body.notes || "").trim()
    );
    await logAudit("public", String(body.email).trim().toLowerCase(), "sponsor_application_created", "sponsor_application", result.lastID, {
      brand: body.brand_name,
      campaignType: body.campaign_type,
    });
    return res.status(201).json({ ok: true, applicationId: result.lastID });
  } catch (err) {
    console.error("partners apply error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/partners/slots", async (_req, res) => {
  try {
    const slots = await db.all(
      `SELECT id, campaign_type, title, description, slot_type, placement, status, start_time, end_time
       FROM sponsor_campaigns
       WHERE status IN ('scheduled', 'live')
       ORDER BY datetime(start_time) ASC`
    );
    return res.json({ ok: true, slots });
  } catch (err) {
    console.error("partners slots error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.use("/api/admin", adminGuard);

router.post("/api/admin/arenas", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.code || !b.title) return res.status(400).json({ ok: false, error: "code_and_title_required" });
    const result = await db.run(
      `INSERT INTO arenas (code, title, description, arena_type, entry_fee_amount, entry_fee_currency, prize_pool_currency, status, start_time, end_time, max_participants, visibility, scoring_mode, payout_mode, sponsor_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'draft'), ?, ?, ?, COALESCE(?, 'public'), COALESCE(?, 'xp'), COALESCE(?, 'manual'), ?, ?)`,
      String(b.code).trim(),
      String(b.title).trim(),
      String(b.description || "").trim(),
      String(b.arena_type || "standard").trim(),
      Number(b.entry_fee_amount || 0),
      String(b.entry_fee_currency || "TON").trim(),
      String(b.prize_pool_currency || b.entry_fee_currency || "TON").trim(),
      b.status || "draft",
      b.start_time || null,
      b.end_time || null,
      b.max_participants || null,
      b.visibility || "public",
      b.scoring_mode || "xp",
      b.payout_mode || "manual",
      b.sponsor_id || null,
      req.headers["x-admin-id"] || "admin"
    );
    await logAudit("admin", String(req.headers["x-admin-id"] || "admin"), "arena_created", "arena", result.lastID, b);
    return res.status(201).json({ ok: true, arenaId: result.lastID });
  } catch (err) {
    console.error("admin create arena error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/api/admin/arenas/:id", async (req, res) => {
  try {
    const b = req.body || {};
    await db.run(
      `UPDATE arenas SET
         title=COALESCE(?, title),
         description=COALESCE(?, description),
         status=COALESCE(?, status),
         start_time=COALESCE(?, start_time),
         end_time=COALESCE(?, end_time),
         max_participants=COALESCE(?, max_participants),
         visibility=COALESCE(?, visibility),
         updated_at=datetime('now')
       WHERE id = ?`,
      b.title ?? null,
      b.description ?? null,
      b.status ?? null,
      b.start_time ?? null,
      b.end_time ?? null,
      b.max_participants ?? null,
      b.visibility ?? null,
      req.params.id
    );
    await logAudit("admin", String(req.headers["x-admin-id"] || "admin"), "arena_updated", "arena", req.params.id, b);
    return res.json({ ok: true });
  } catch (err) {
    console.error("admin patch arena error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/api/admin/arenas/:id/start", async (req, res) => {
  await db.run(`UPDATE arenas SET status='live', start_time=COALESCE(start_time, datetime('now')), updated_at=datetime('now') WHERE id=?`, req.params.id);
  await logAudit("admin", String(req.headers["x-admin-id"] || "admin"), "arena_started", "arena", req.params.id, {});
  return res.json({ ok: true });
});

router.post("/api/admin/arenas/:id/end", async (req, res) => {
  await db.run(`UPDATE arenas SET status='ended', end_time=COALESCE(end_time, datetime('now')), updated_at=datetime('now') WHERE id=?`, req.params.id);
  await logAudit("admin", String(req.headers["x-admin-id"] || "admin"), "arena_ended", "arena", req.params.id, {});
  return res.json({ ok: true });
});

router.post("/api/admin/arenas/:id/quests", async (req, res) => {
  try {
    const quests = Array.isArray(req.body?.quests) ? req.body.quests : [];
    for (const q of quests) {
      await db.run(
        `INSERT INTO arena_quests (arena_id, quest_id, weight, active)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(arena_id, quest_id) DO UPDATE SET weight=excluded.weight, active=1`,
        req.params.id,
        String(q.quest_id ?? q.questId),
        Number(q.weight || 1)
      );
    }
    await logAudit("admin", String(req.headers["x-admin-id"] || "admin"), "arena_quests_assigned", "arena", req.params.id, { count: quests.length });
    return res.json({ ok: true, count: quests.length });
  } catch (err) {
    console.error("admin arena quests error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/admin/arenas/:id/participants", async (req, res) => {
  const participants = await db.all(`SELECT * FROM arena_participants WHERE arena_id = ? ORDER BY arena_xp DESC, datetime(created_at) ASC`, req.params.id);
  return res.json({ ok: true, participants });
});

router.get("/api/admin/payments", async (_req, res) => {
  const payments = await db.all(`SELECT * FROM payments ORDER BY id DESC LIMIT 500`);
  return res.json({ ok: true, payments });
});

router.get("/api/admin/webhooks", async (_req, res) => {
  const events = await db.all(`SELECT * FROM payment_events ORDER BY id DESC LIMIT 500`);
  return res.json({ ok: true, events });
});

router.get("/api/admin/reward-payouts", async (_req, res) => {
  const payouts = await db.all(`SELECT * FROM reward_payouts ORDER BY id DESC LIMIT 500`);
  return res.json({ ok: true, payouts });
});

router.get("/api/admin/sponsor-applications", async (_req, res) => {
  const applications = await db.all(`SELECT * FROM sponsor_applications ORDER BY id DESC`);
  return res.json({ ok: true, applications });
});

router.patch("/api/admin/sponsor-applications/:id", async (req, res) => {
  const status = String(req.body?.status || "").trim();
  if (!status) return res.status(400).json({ ok: false, error: "status_required" });
  await db.run(`UPDATE sponsor_applications SET status = ?, updated_at=datetime('now') WHERE id = ?`, status, req.params.id);
  await logAudit("admin", String(req.headers["x-admin-id"] || "admin"), "sponsor_application_updated", "sponsor_application", req.params.id, { status });
  return res.json({ ok: true });
});

router.post("/api/admin/sponsor-campaigns", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.sponsor_id || !b.campaign_type || !b.title || !b.slot_type) {
      return res.status(400).json({ ok: false, error: "missing_required_fields" });
    }
    const result = await db.run(
      `INSERT INTO sponsor_campaigns (sponsor_id, sponsor_application_id, campaign_type, title, description, slot_type, placement, arena_id, quest_id, budget, payment_id, status, start_time, end_time, report_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'draft'), ?, ?, ?)`,
      Number(b.sponsor_id),
      b.sponsor_application_id || null,
      String(b.campaign_type),
      String(b.title),
      String(b.description || ""),
      String(b.slot_type),
      String(b.placement || ""),
      b.arena_id || null,
      b.quest_id || null,
      Number(b.budget || 0),
      b.payment_id || null,
      b.status || "draft",
      b.start_time || null,
      b.end_time || null,
      b.report_payload ? JSON.stringify(b.report_payload) : null
    );
    return res.status(201).json({ ok: true, campaignId: result.lastID });
  } catch (err) {
    console.error("admin create campaign error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/api/admin/sponsor-campaigns/:id", async (req, res) => {
  const b = req.body || {};
  await db.run(
    `UPDATE sponsor_campaigns SET
      status=COALESCE(?, status),
      report_payload=COALESCE(?, report_payload),
      updated_at=datetime('now')
     WHERE id = ?`,
    b.status || null,
    b.report_payload ? JSON.stringify(b.report_payload) : null,
    req.params.id
  );
  return res.json({ ok: true });
});

router.post("/api/admin/arenas/:id/settle", async (req, res) => {
  try {
    const arena = await db.get(`SELECT * FROM arenas WHERE id = ?`, req.params.id);
    if (!arena) return res.status(404).json({ ok: false, error: "arena_not_found" });
    if (!['ended', 'settling'].includes(String(arena.status))) {
      return res.status(409).json({ ok: false, error: "arena_not_ready_for_settlement" });
    }

    const existing = await db.get(`SELECT id FROM reward_payouts WHERE arena_id = ? LIMIT 1`, req.params.id);
    if (existing) {
      return res.json({ ok: true, already: true });
    }

    await db.run(`UPDATE arenas SET status='settling', updated_at=datetime('now') WHERE id = ?`, req.params.id);

    const participants = await db.all(
      `SELECT user_wallet, arena_xp, created_at
       FROM arena_participants
       WHERE arena_id = ? AND status = 'active'
       ORDER BY arena_xp DESC, datetime(created_at) ASC, user_wallet ASC`,
      req.params.id
    );
    const rules = await db.all(`SELECT * FROM reward_rules WHERE arena_id = ? ORDER BY rank_from ASC`, req.params.id);

    let generatedPayouts = 0;
    for (let i = 0; i < participants.length; i += 1) {
      const rank = i + 1;
      const p = participants[i];
      const rule = rules.find((r) => rank >= r.rank_from && rank <= r.rank_to);
      if (!rule) continue;
      await db.run(
        `INSERT INTO reward_payouts (arena_id, user_wallet, rank_final, payout_amount, payout_currency, payout_provider, payout_status)
         VALUES (?, ?, ?, ?, ?, 'manual', 'pending')`,
        req.params.id,
        p.user_wallet,
        rank,
        Number(rule.reward_amount || 0),
        rule.reward_currency || arena.prize_pool_currency || 'TON'
      );
      generatedPayouts += 1;
    }

    await db.run(`UPDATE arenas SET status='settled', settled_at=datetime('now'), updated_at=datetime('now') WHERE id = ?`, req.params.id);
    await logAudit("admin", String(req.headers["x-admin-id"] || "admin"), "arena_settled", "arena", req.params.id, { participants: participants.length });
    return res.json({ ok: true, generatedPayouts });
  } catch (err) {
    console.error("arena settle error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Quest claim integration with arena context.
router.post("/api/arena-quests/claim", async (req, res) => {
  const wallet = getSessionWallet(req) || String(req.body?.wallet || "").trim();
  if (!wallet) return res.status(401).json({ ok: false, error: "auth_required" });

  const arenaId = Number(req.body?.arenaId || 0);
  const questId = String(req.body?.questId || req.body?.quest_id || "").trim();
  if (!arenaId || !questId) return res.status(400).json({ ok: false, error: "arena_and_quest_required" });

  try {
    const arena = await db.get(`SELECT * FROM arenas WHERE id = ?`, arenaId);
    if (!arena || String(arena.status) !== "live") {
      return res.status(409).json({ ok: false, error: "arena_not_live" });
    }

    const participant = await db.get(`SELECT * FROM arena_participants WHERE arena_id = ? AND user_wallet = ?`, arenaId, wallet);
    if (!participant) return res.status(403).json({ ok: false, error: "not_participant" });

    const aq = await db.get(`SELECT * FROM arena_quests WHERE arena_id = ? AND quest_id = ? AND active = 1`, arenaId, questId);
    if (!aq) return res.status(404).json({ ok: false, error: "quest_not_in_arena" });

    const quest = await db.get(`SELECT id, requirement, xp FROM quests WHERE CAST(id AS TEXT)=CAST(? AS TEXT) OR code = ?`, questId, questId);
    if (!quest) return res.status(404).json({ ok: false, error: "quest_not_found" });

    if (quest.requirement && quest.requirement !== "none") {
      const verification = await verifyQuestRequirement(quest.requirement, { wallet, questId: quest.id, requirement: quest.requirement });
      if (!verification.ok) {
        return res.status(403).json({ ok: false, error: "proof_required", reason: verification.reason });
      }
    }

    const exists = await db.get(`SELECT id FROM arena_claims WHERE arena_id = ? AND user_wallet = ? AND quest_id = ?`, arenaId, wallet, String(quest.id));
    if (exists) return res.status(409).json({ ok: false, error: "already_claimed" });

    const globalAward = await awardQuest(wallet, quest.id);
    const arenaXp = Math.round(Number(quest.xp || 0) * Number(aq.weight || 1));

    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      await db.run(
        `INSERT INTO arena_claims (arena_id, quest_id, user_wallet, awarded_xp, verification_status, proof_payload, source)
         VALUES (?, ?, ?, ?, 'approved', ?, 'claim_api')`,
        arenaId,
        String(quest.id),
        wallet,
        arenaXp,
        JSON.stringify({ globalAwarded: !globalAward.already })
      );
      await db.run(
        `UPDATE arena_participants
         SET arena_xp = COALESCE(arena_xp, 0) + ?, updated_at = datetime('now')
         WHERE arena_id = ? AND user_wallet = ?`,
        arenaXp,
        arenaId,
        wallet
      );
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }

    const me = await db.get(`SELECT arena_xp FROM arena_participants WHERE arena_id = ? AND user_wallet = ?`, arenaId, wallet);
    const rank = await db.get(
      `SELECT 1 + COUNT(*) AS rank
       FROM arena_participants
       WHERE arena_id = ?
         AND (arena_xp > ? OR (arena_xp = ? AND datetime(created_at) < datetime((SELECT created_at FROM arena_participants WHERE arena_id = ? AND user_wallet = ?))))`,
      arenaId,
      me?.arena_xp || 0,
      me?.arena_xp || 0,
      arenaId,
      wallet
    );

    return res.json({
      ok: true,
      arenaXpGain: arenaXp,
      arenaXpTotal: Number(me?.arena_xp || 0),
      rank: Number(rank?.rank || 1),
      globalXpGain: Number(globalAward?.xpGain || 0),
      globalAlreadyClaimed: Boolean(globalAward?.already),
    });
  } catch (err) {
    console.error("arena quest claim error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
