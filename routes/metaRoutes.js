import express from "express";
import { LEVELS, MAX_XP } from "../config/progression.js";
import { getCache, setCache } from "../utils/cache.js";

const router = express.Router();

router.get("/api/meta/progression", (_req, res) => {
  const key = "progression";
  const cached = getCache(key);
  if (cached) return res.json(cached);
  const data = { levels: LEVELS, maxXP: MAX_XP };
  setCache(key, data, 60_000);
  res.json(data);
});

export default router;
