import session from "express-session";
import db from "./db.js";
import { deriveLevel } from "../config/progression.js";

function cookieSecure() {
  return process.env.NODE_ENV === "production";
}

export function installSession(app) {
  app.use(
    session({
      name: "7gc.sid",
      secret: process.env.SESSION_SECRET || "change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "none",
        secure: true,
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    })
  );

  // Dev helper: accept cookie "7gc.sid=w:<wallet>" to materialize a session
  app.use(async (req, _res, next) => {
    try {
      if (!req.session?.userId) {
        const ck = req.headers.cookie || "";
        const m = /(?:^|;\s*)7gc\.sid=([^;]+)/.exec(ck);
        if (m) {
          const raw = decodeURIComponent(m[1]);
          if (raw.startsWith("w:")) {
            const wallet = raw.slice(2).trim();
            if (wallet) {
              let row = await db.get("SELECT wallet FROM users WHERE wallet=?", wallet);
              if (!row?.wallet) await db.run("INSERT OR IGNORE INTO users(wallet) VALUES(?)", wallet);
              row = await db.get("SELECT wallet FROM users WHERE wallet=?", wallet);
              if (row?.wallet) {
                req.session.userId = row.wallet;
                req.session.wallet = row.wallet;
              }
            }
          }
        }
      }
    } catch {}
    next();
  });
}

export async function bindWalletSession(req, wallet) {
  const address = String(wallet || "").trim();
  if (!address) {
    throw new Error("wallet_required");
  }

  await db.run(
    `INSERT INTO users (wallet, xp, tier, levelName, levelSymbol, levelProgress, nextXP, updatedAt)
     VALUES (?, 0, 'Free', 'Shellborn', '🐚', 0, 10000, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(wallet) DO NOTHING`,
    address
  );
  const user = await db.get("SELECT wallet, xp FROM users WHERE wallet = ?", address);
  if (!user) throw new Error("user_not_found");

  req.session.wallet = address;
  req.session.userId = address;
  req.session.cookie.sameSite = "none";
  req.session.cookie.secure = true;
  req.session.cookie.httpOnly = true;

  const lvl = deriveLevel(user.xp || 0);
  return {
    wallet: address,
    xp: lvl.totalXP,
    levelTier: lvl.levelTier,
    levelName: lvl.levelName,
    levelSymbol: lvl.levelSymbol,
    progress: lvl.progress,
    nextXP: lvl.nextNeed,
  };
}

export async function logoutSession(wallet) {
  const address = String(wallet || "").trim();
  if (!address) return;
  await db.run("DELETE FROM sessions WHERE sid = ?", address).catch(() => {});
}
