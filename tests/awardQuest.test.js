let db, awardQuest;

beforeAll(async () => {
  process.env.SQLITE_FILE = ':memory:';
  ({ default: db } = await import('../db.js'));
  ({ awardQuest } = await import('../lib/quests.js'));
  try { await db.exec("ALTER TABLE quests ADD COLUMN code TEXT;"); } catch {}
  await db.run("INSERT INTO quests (id, code, title, xp, active) VALUES ('q1','Q1','Test Quest',10,1)");
  await db.run("INSERT INTO users (wallet) VALUES ('wallet1')");
  await db.run("INSERT INTO users (wallet) VALUES ('wallet2')");
});

afterAll(async () => {
  await db.close();
});

describe('awardQuest', () => {
  test('awards xp for valid quest', async () => {
    const res = await awardQuest('wallet1', 'q1');
    expect(res.ok).toBe(true);
    expect(res.already).toBe(false);
    const row = await db.get("SELECT xp FROM users WHERE wallet='wallet1'");
    expect(row.xp).toBe(10);
  });

  test('rejects invalid quest', async () => {
    const res = await awardQuest('wallet1', 'missing');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('quest-not-found');
  });

  test('prevents duplicate claims', async () => {
    await awardQuest('wallet2', 'q1');
    const again = await awardQuest('wallet2', 'q1');
    expect(again.already).toBe(true);
    const row = await db.get("SELECT xp FROM users WHERE wallet='wallet2'");
    expect(row.xp).toBe(10);
  });
});
