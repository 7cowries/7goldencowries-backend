import express from "express";
import db from "../lib/db.js";
import { getSessionWallet } from "../utils/session.js";

const router = express.Router();

const PROVIDERS = {
  twitter: {
    nullColumns: ["twitterHandle", "twitter_username", "twitter_id"],
  },
  telegram: {
    nullColumns: ["telegramHandle", "telegram_username", "telegramId"],
  },
  discord: {
    nullColumns: [
      "discordHandle",
      "discord_username",
      "discordId",
      "discord_id",
      "discordAccessToken",
      "discordRefreshToken",
    ],
    valueColumns: [
      ["discordTokenExpiresAt", null],
      ["discordGuildMember", 0],
    ],
  },
};

router.post("/:provider/unlink", async (req, res) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) {
      return res.status(401).json({ error: "wallet_required" });
    }

    const provider = String(req.params.provider || "").toLowerCase();
    const config = PROVIDERS[provider];
    if (!config) {
      return res.status(400).json({ error: "unknown_provider" });
    }

    const user = await db.get(
      "SELECT socials FROM users WHERE wallet = ?",
      wallet
    );
    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }

    let socials = {};
    if (user.socials) {
      try {
        const parsed = JSON.parse(user.socials);
        if (parsed && typeof parsed === "object") {
          socials = parsed;
        }
      } catch {
        socials = {};
      }
    }

    socials[provider] = { connected: false };
    const socialsJson = JSON.stringify(socials);

    const sets = [];
    const params = [];

    for (const column of config.nullColumns || []) {
      sets.push(`${column} = NULL`);
    }
    for (const [column, value] of config.valueColumns || []) {
      sets.push(`${column} = ?`);
      params.push(value);
    }

    sets.push("socials = ?");
    params.push(socialsJson);

    sets.push("updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')");

    params.push(wallet);

    await db.run(
      `UPDATE users SET ${sets.join(", ")} WHERE wallet = ?`,
      params
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("social unlink error", err);
    return res.status(500).json({ error: "unlink_failed" });
  }
});

export default router;
