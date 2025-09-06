let db, awardQuest;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  ({ default: db } = await import('../db.js'));
  ({ awardQuest } = await import('../lib/quests.js'));
  try { await db.exec("ALTER TABLE quests ADD COLUMN code TEXT;"); } catch {}
  await db.exec(`CREATE TABLE IF NOT EXISTS tier_multipliers (
        tier TEXT PRIMARY KEY,
        multiplier REAL,
        label TEXT
      );`);
  await db.run("INSERT INTO tier_multipliers (tier,multiplier,label) VALUES ('free',1.0,'Free'),('tier1',1.1,'Tier 1'),('tier3',1.5,'Tier 3')");
  await db.run("INSERT INTO quests (id, code, title, xp, active) VALUES ('q1','Q1','Test Quest',100,1)");
  await db.run("INSERT INTO users (wallet, tier, updatedAt) VALUES ('wallet1','free', CURRENT_TIMESTAMP)");
  await db.run("INSERT INTO users (wallet, tier, updatedAt) VALUES ('wallet2','tier1', CURRENT_TIMESTAMP)");
  await db.run("INSERT INTO users (wallet, tier, updatedAt) VALUES ('wallet3','tier3', CURRENT_TIMESTAMP)");
});

afterAll(async () => {
  await db.close();
});

describe('awardQuest', () => {
  test('applies tier multipliers', async () => {
    await awardQuest('wallet1', 'q1'); // free
    await awardQuest('wallet2', 'q1'); // tier1
    await awardQuest('wallet3', 'q1'); // tier3
    const r1 = await db.get("SELECT xp FROM users WHERE wallet='wallet1'");
    const r2 = await db.get("SELECT xp FROM users WHERE wallet='wallet2'");
    const r3 = await db.get("SELECT xp FROM users WHERE wallet='wallet3'");
    expect(r1.xp).toBe(100);
    expect(r2.xp).toBe(110);
    expect(r3.xp).toBe(150);
  });

  test('rejects invalid quest', async () => {
    const res = await awardQuest('wallet1', 'missing');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('quest-not-found');
  });

  test('prevents duplicate claims', async () => {
    await awardQuest('wallet1', 'q1');
    const again = await awardQuest('wallet1', 'q1');
    expect(again.already).toBe(true);
    const row = await db.get("SELECT xp FROM users WHERE wallet='wallet1'");
    expect(row.xp).toBe(100); // unchanged
  });
});
