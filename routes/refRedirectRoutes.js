import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/ref/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!code) return res.status(404).json({ error: "Invalid code" });
    const row = await db.get("SELECT wallet FROM users WHERE referral_code = ?", [code]);
    if (!row) return res.status(404).json({ error: "Invalid code" });
    res.cookie("ref", code, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      path: "/",
    });
    req.session.ref = code;
    const redirectUrl = process.env.FRONTEND_URL || "/";
    return res.redirect(302, redirectUrl);
  } catch (e) {
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
