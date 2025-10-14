import { Router } from "express";
import db from "../db.js";
const router = Router();
router.use((req, res, next) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }
  next();
});
router.post("/quests/toggle", async (req, res) => {
  const { key, active } = req.body || {};
  if (!key || typeof active !== "boolean") {
    return res.status(400).json({ ok:false, error:"key-and-active-required" });
  }
  try {
    const r = await db.run("UPDATE quests_v2 SET active=? WHERE key=?", active ? 1 : 0, key);
    return res.json({ ok:true, key, active, changes:r?.changes ?? 0 });
  } catch (e) {
    try {
      const r2 = await db.run("UPDATE quests SET active=? WHERE key=?", active ? 1 : 0, key);
      return res.json({ ok:true, key, active, changes:r2?.changes ?? 0, legacy:true });
    } catch (e2) {
      return res.status(500).json({ ok:false, error:e2.message });
    }
  }
});
export default router;
