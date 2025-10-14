import db from "../db.js";

const key = process.env.KEY || "probe_1000";
const active = process.env.ACTIVE === "1" || process.env.ACTIVE === "true";

async function run() {
  // Try quests_v2 first, then legacy quests
  let changes = 0;
  try {
    const res = await db.run("UPDATE quests_v2 SET active=? WHERE key=?", active ? 1 : 0, key);
    changes = res?.changes ?? 0;
    console.log(`[toggleProbe] quests_v2 updated: ${changes}`);
  } catch (e) {
    console.warn("[toggleProbe] quests_v2 not available, trying legacy quests…");
    try {
      const res2 = await db.run("UPDATE quests SET active=? WHERE key=?", active ? 1 : 0, key);
      changes = res2?.changes ?? 0;
      console.log(`[toggleProbe] legacy quests updated: ${changes}`);
    } catch (e2) {
      console.error("[toggleProbe] both updates failed:", e2.message);
      process.exit(1);
    }
  }
  console.log(`[toggleProbe] key='${key}' active=${active} changes=${changes}`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
