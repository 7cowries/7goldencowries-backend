import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { ensureUsersSchema } from '../db/migrateUsers.js';

describe('ensureUsersSchema migration', () => {
  test('upgrades minimal users table', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT);');
    await ensureUsersSchema(db);
    const cols = await db.all("PRAGMA table_info(users)");
    const names = cols.map(c => c.name);
    const expected = ['id','wallet','xp','level','levelName','levelSymbol','levelProgress','nextXP','referral_code','referred_by','telegram_username','twitter_username','twitter_id','discord_username','discord_id','socials','createdAt','updatedAt'];
    expected.forEach(c => expect(names).toContain(c));
    const idx = await db.all("PRAGMA index_list('users')");
    const refIdx = [];
    for (const i of idx) {
      if (i.unique) {
        const info = await db.all(`PRAGMA index_info(${i.name})`);
        if (info.some(r => r.name === 'referral_code')) refIdx.push(i);
      }
    }
    expect(refIdx.length).toBe(1);
    await db.close();
  });

  test('rebuild handles missing referral_code column', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT UNIQUE, xp INTEGER);
                   INSERT INTO users (wallet, xp) VALUES ('w1', 5);`);
    await ensureUsersSchema(db);
    const row = await db.get("SELECT xp FROM users WHERE wallet='w1'");
    expect(row.xp).toBe(5);
    const cols = await db.all("PRAGMA table_info(users)");
    expect(cols.some(c => c.name === 'referral_code')).toBe(true);
    await db.close();
  });
});
