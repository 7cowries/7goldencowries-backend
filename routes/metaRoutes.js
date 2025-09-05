import express from "express";
import { LEVELS, MAX_XP } from "../config/progression.js";

const router = express.Router();

router.get("/api/meta/progression", (_req, res) => {
  res.json({ levels: LEVELS, maxXP: MAX_XP });
});

export default router;
