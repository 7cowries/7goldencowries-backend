import express from "express";
import passport from "passport";
import db from "../db.js";

const router = express.Router();

const CLIENT_URL =
  process.env.CLIENT_URL ||
  process.env.FRONTEND_URL ||
  "http://localhost:3000";

/** Accept state as base64 or plain text wallet */
function parseWalletFromState(state) {
  if (!state) return null;
  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8");
    if (decoded && decoded.length >= 10) return decoded;
  } catch {}
  return state; // fallback: treat as raw wallet
}

/** Ensure user exists (for first-time linkers) */
async function ensureUser(wallet, extra = {}) {
  const row = await db.get("SELECT wallet FROM users WHERE wallet = ?", wallet);
  if (!row) {
    await db.run(
      `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, twitterHandle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      wallet,
      0,
      "Free",
      "Shellborn",
      "🐚",
      0,
      10000,
      extra.twitterHandle || null
    );
  }
}

/* ------------------------- TWITTER (X) ------------------------- */
/** Start Twitter OAuth — store wallet state (base64 or raw) */
router.get("/auth/twitter", (req, res, next) => {
  const incoming = req.query.state;
  if (!incoming) return res.status(400).send("Missing wallet state");
  req.session.state = incoming;
  req.session.save((err) => {
    if (err) return res.status(500).send("Session save failed");
    passport.authenticate("twitter")(req, res, next);
  });
});

/** Twitter callback — link wallet → twitter handle */
router.get("/auth/twitter/callback", (req, res, next) => {
  passport.authenticate("twitter", { failureRedirect: "/" }, (err, user) => {
    if (err || !user) {
      console.error("❌ Twitter Auth Failed:", err);
      return res.redirect("/");
    }
    req.logIn(user, async (err) => {
      if (err) {
        console.error("❌ Login error after Twitter auth:", err);
        return res.redirect("/");
      }
      try {
        const twitterHandle = req.user?.username;
        // session OR fallback ?wallet=
        const wallet =
          parseWalletFromState(req.session?.state) || parseWalletFromState(req.query.wallet);
        if (!wallet || !twitterHandle) {
          return res.status(400).send("Missing wallet or Twitter handle");
        }

        await ensureUser(wallet, { twitterHandle });
        await db.run(
          "UPDATE users SET twitterHandle = ? WHERE wallet = ?",
          twitterHandle,
          wallet
        );

        // Mirror in social_links for Profile page
        await db.run(
          `INSERT INTO social_links (wallet, twitter) VALUES (?, ?)
           ON CONFLICT(wallet) DO UPDATE SET twitter=excluded.twitter`,
          [wallet, twitterHandle]
        );

        return res.redirect(`${CLIENT_URL}/profile?linked=twitter`);
      } catch (e) {
        console.error("❌ Twitter callback error:", e);
        return res.status(500).send("Internal server error during Twitter linking");
      }
    });
  })(req, res, next);
});

/** Manual twitter linking fallback */
router.post("/link-twitter", async (req, res) => {
  const { wallet, twitter } = req.body;
  if (!wallet || !twitter) return res.status(400).json({ error: "Missing wallet or twitter" });
  try {
    await ensureUser(wallet, { twitterHandle: twitter });
    await db.run("UPDATE users SET twitterHandle = ? WHERE wallet = ?", twitter, wallet);
    await db.run(
      `INSERT INTO social_links (wallet, twitter) VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET twitter=excluded.twitter`,
      [wallet, twitter]
    );
    res.json({ message: "Twitter handle linked" });
  } catch (e) {
    console.error("❌ Link Twitter error:", e);
    res.status(500).json({ error: "Database error" });
  }
});

/* ------------------------- TELEGRAM (per-user linking) ------------------------- */
/**
 * Modes:
 *  A) Secure login widget (if TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_NAME are set)
 *     - GET /auth/telegram/start -> renders Telegram Login Widget
 *     - GET /auth/telegram/verify (Telegram redirects here) -> verify signature -> link
 *  B) Fallback (no bot): simple username form
 *     - GET /auth/telegram/start -> renders small HTML form
 *     - POST /auth/telegram/manual -> link with provided username
 */
const HAS_TELEGRAM_BOT =
  !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_BOT_NAME;

router.get("/auth/telegram/start", (req, res) => {
  const incoming = req.query.state;
  if (!incoming) return res.status(400).send("Missing wallet state");
  req.session.state = incoming;

  if (HAS_TELEGRAM_BOT) {
    const botName = process.env.TELEGRAM_BOT_NAME; // without @
    const html = `
<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect Telegram</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;background:#0b1220;color:#e7eef3}
.card{max-width:520px;margin:0 auto;padding:24px;border-radius:16px;background:#0f1a2b;box-shadow:0 10px 30px rgba(0,0,0,.35)}
h1{font-size:22px;margin:0 0 12px}
p{opacity:.85}.muted{opacity:.6}
</style></head>
<body><div class="card">
<h1>Connect your Telegram</h1>
<p class="muted">Click the button below to authorize with Telegram.</p>
<script async src="https://telegram.org/js/telegram-widget.js?22"
  data-telegram-login="${botName}"
  data-size="large"
  data-userpic="false"
  data-request-access="write"
  data-auth-url="/auth/telegram/verify"></script>
<p class="muted">If the widget doesn't appear, ensure your bot is reachable.</p>
</div></body></html>`;
    return res.type("html").send(html);
  }

  // Fallback: small username form
  const html = `
<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect Telegram</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;background:#0b1220;color:#e7eef3}
.card{max-width:520px;margin:0 auto;padding:24px;border-radius:16px;background:#0f1a2b;box-shadow:0 10px 30px rgba(0,0,0,.35)}
h1{font-size:22px;margin:0 0 12px}
input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #22314a;background:#0b1526;color:#e7eef3}
button{margin-top:12px;padding:10px 14px;border-radius:10px;border:none;background:#10b981;color:#03151a;font-weight:600;cursor:pointer}
.muted{opacity:.7}
</style></head>
<body><div class="card">
<h1>Connect your Telegram</h1>
<p class="muted">Enter your Telegram username (without @).</p>
<form method="POST" action="/auth/telegram/manual">
  <input type="text" name="username" placeholder="e.g. gigixyz" required />
  <button type="submit">Link Telegram</button>
</form>
</div></body></html>`;
  return res.type("html").send(html);
});

/** Fallback username form submit */
router.post("/auth/telegram/manual", async (req, res) => {
  try {
    const wallet = parseWalletFromState(req.session?.state);
    if (!wallet) return res.status(400).send("Missing wallet state");
    const username = (req.body?.username || "").trim().replace(/^@/, "");
    if (!username) return res.status(400).send("Missing Telegram username");

    await ensureUser(wallet);
    await db.run(
      `INSERT INTO social_links (wallet, telegram) VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET telegram=excluded.telegram`,
      [wallet, username]
    );
    return res.redirect(`${CLIENT_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("❌ Telegram manual link error:", e);
    res.status(500).send("Telegram link failed");
  }
});

/** Secure Telegram Login Widget verification */
router.get("/auth/telegram/verify", async (req, res) => {
  if (!HAS_TELEGRAM_BOT) return res.status(400).send("Telegram bot not configured");
  try {
    // signature verify
    const params = { ...req.query }; // includes id, username, first_name, auth_date, hash, etc
    const hash = params.hash;
    delete params.hash;

    const pairs = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`);
    const dataCheckString = pairs.join("\n");

    const crypto = await import("crypto");
    const secret = crypto
      .createHash("sha256")
      .update(process.env.TELEGRAM_BOT_TOKEN)
      .digest();
    const hmac = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");

    if (hmac !== hash) {
      console.error("Telegram verify failed: bad signature");
      return res.status(403).send("Telegram verification failed");
    }

    const wallet = parseWalletFromState(req.session?.state);
    if (!wallet) return res.status(400).send("Missing wallet state");
    const username = (req.query.username || "").trim().replace(/^@/, "");
    if (!username) return res.status(400).send("No Telegram username from Telegram");

    await ensureUser(wallet);
    await db.run(
      `INSERT INTO social_links (wallet, telegram) VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET telegram=excluded.telegram`,
      [wallet, username]
    );

    return res.redirect(`${CLIENT_URL}/profile?linked=telegram`);
  } catch (e) {
    console.error("❌ Telegram verify error:", e);
    res.status(500).send("Telegram link failed");
  }
});

/* ------------------------- DISCORD ------------------------- */
router.get("/auth/discord", (req, res) => {
  const incoming = req.query.state;
  if (!incoming) return res.status(400).send("Missing wallet state");
  req.session.state = incoming;

  const cid = process.env.DISCORD_CLIENT_ID;
  const redirect = process.env.DISCORD_REDIRECT;
  if (!cid || !redirect) return res.status(500).send("Discord env vars not set");

  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(cid)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&scope=identify`;
  res.redirect(url);
});

router.get("/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");

    const wallet =
      parseWalletFromState(req.session?.state) || parseWalletFromState(req.query.wallet);
    if (!wallet) return res.status(400).send("Missing wallet state");

    const cid = process.env.DISCORD_CLIENT_ID;
    const secret = process.env.DISCORD_CLIENT_SECRET;
    const redirect = process.env.DISCORD_REDIRECT;
    if (!cid || !secret || !redirect) {
      return res.status(500).send("Discord env vars not set");
    }

    // 1) token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cid,
        client_secret: secret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("Discord token error:", body);
      return res.status(502).send("Discord token exchange failed");
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // 2) me
    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      const body = await meRes.text();
      console.error("Discord /@me error:", body);
      return res.status(502).send("Discord user fetch failed");
    }
    const me = await meRes.json();
    const display =
      me.global_name ||
      (me.username && me.discriminator && me.discriminator !== "0"
        ? `${me.username}#${me.discriminator}`
        : me.username) ||
      "discord-user";

    await ensureUser(wallet);
    await db.run(
      `INSERT INTO social_links (wallet, discord) VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET discord=excluded.discord`,
      [wallet, display]
    );

    return res.redirect(`${CLIENT_URL}/profile?linked=discord`);
  } catch (e) {
    console.error("❌ Discord callback error:", e);
    res.status(500).send("Discord link failed");
  }
});

/* ------------------------- TIER/UTILITY ------------------------- */
router.post("/assign-tier", async (req, res) => {
  const { wallet, tier } = req.body;
  if (!wallet || !tier) return res.status(400).json({ error: "Missing wallet or tier" });
  try {
    await ensureUser(wallet);
    await db.run("UPDATE users SET tier = ? WHERE wallet = ?", tier, wallet);
    res.json({ message: `Tier '${tier}' assigned to ${wallet}` });
  } catch (err) {
    console.error("❌ Assign tier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/set-subscription", async (req, res) => {
  const { wallet, tier } = req.body;
  if (!wallet || !tier) return res.status(400).json({ error: "Missing wallet or tier" });
  try {
    const row = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
    if (!row) return res.status(404).json({ error: "User not found" });
    await db.run("UPDATE users SET tier = ? WHERE wallet = ?", tier, wallet);
    res.json({ message: `Subscription updated to ${tier}` });
  } catch (err) {
    console.error("❌ Subscription update error:", err);
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

router.get("/session-debug", (req, res) => {
  res.json({ session: req.session });
});

export default router;
