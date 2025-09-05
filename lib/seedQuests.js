import fs from "fs";
import path from "path";
import db from "../db.js";

export async function seedQuestsFromFile(filePath) {
  const full = path.resolve(filePath);
  const raw = fs.readFileSync(full, "utf8");
  const items = JSON.parse(raw);

  const stmt = await db.prepare(`
    INSERT INTO quests (id, title, description, category, kind, url, xp, active, sort, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      description=excluded.description,
      category=excluded.category,
      kind=excluded.kind,
      url=excluded.url,
      xp=excluded.xp,
      active=excluded.active,
      sort=excluded.sort,
      updatedAt=strftime('%s','now')
  `);

  for (const q of items) {
    await stmt.run(
      q.id,
      q.title,
      q.description ?? "",
      q.category ?? "All",
      q.kind ?? "link",
      q.url ?? "",
      Number(q.xp ?? 0),
      q.active === false ? 0 : 1,
      Number(q.sort ?? 0)
    );
  }
  await stmt.finalize();
  return { count: items.length };
}

export default seedQuestsFromFile;

