import { deriveLevel } from "../config/progression.js";

/**
 * Ensure the users table matches the expected schema.
 * @param {import('sqlite').Database} db
 */
export async function ensureUsersSchema(db) {
  console.log('Migration: ensuring users schema');
  const targetCols = [
    ['id', 'INTEGER'],
    ['wallet', 'TEXT'],
    ['xp', 'INTEGER'],
    ['tier', 'TEXT'],
    ['subscriptionTier', 'TEXT'],
    ['level', 'INTEGER'],
    ['levelName', 'TEXT'],
    ['levelSymbol', 'TEXT'],
    ['levelProgress', 'REAL'],
    ['nextXP', 'INTEGER'],
    ['twitterHandle', 'TEXT'],
    ['telegramId', 'TEXT'],
    ['telegramHandle', 'TEXT'],
    ['discordId', 'TEXT'],
    ['discordHandle', 'TEXT'],
    ['discordAccessToken', 'TEXT'],
    ['discordRefreshToken', 'TEXT'],
    ['discordTokenExpiresAt', 'INTEGER'],
    ['discordGuildMember', 'INTEGER'],
    ['referral_code', 'TEXT'],
    ['referred_by', 'TEXT'],
    ['telegram_username', 'TEXT'],
    ['twitter_username', 'TEXT'],
    ['twitter_id', 'TEXT'],
    ['discord_username', 'TEXT'],
    ['discord_id', 'TEXT'],
    ['socials', 'TEXT'],
    ['paid', 'INTEGER'],
    ['lastPaymentAt', 'TEXT'],
    ['subscriptionPaidAt', 'TEXT'],
    ['subscriptionClaimedAt', 'TEXT'],
    ['createdAt', 'TEXT'],
    ['updatedAt', 'TEXT'],
  ];

  const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
  if (!row) {
    await db.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT UNIQUE,
      xp INTEGER DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'Free',
      subscriptionTier TEXT DEFAULT 'Free',
      level INTEGER DEFAULT 1,
      levelName TEXT DEFAULT 'Shellborn',
      levelSymbol TEXT DEFAULT '🐚',
      levelProgress REAL DEFAULT 0,
      nextXP INTEGER DEFAULT 10000,
      twitterHandle TEXT,
      telegramId TEXT,
      telegramHandle TEXT,
      discordId TEXT,
      discordHandle TEXT,
      discordAccessToken TEXT,
      discordRefreshToken TEXT,
      discordTokenExpiresAt INTEGER,
      discordGuildMember INTEGER DEFAULT 0,
      referral_code TEXT,
      referred_by TEXT,
      telegram_username TEXT,
      twitter_username TEXT,
      twitter_id TEXT,
      discord_username TEXT,
      discord_id TEXT,
      socials TEXT,
      paid INTEGER DEFAULT 0,
      lastPaymentAt TEXT,
      subscriptionPaidAt TEXT,
      subscriptionClaimedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      UNIQUE(referral_code)
    );`);
    await db.exec("CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet);");
    await backfillUsersDefaults(db);
    return;
  }

  const tableInfo = await db.all("PRAGMA table_info(users)");
  const existingCols = new Set(tableInfo.map(c => c.name));
  for (const [name, type] of targetCols) {
    if (!existingCols.has(name)) {
      console.log(`Migration: added column ${name}`);
      await db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type};`);
    }
  }

  await backfillUsersDefaults(db);

  // Determine if rebuild is needed
  let rebuild = false;
  const pkCol = tableInfo.find(c => c.pk === 1)?.name;
  if (pkCol !== 'id') rebuild = true;
  const idxList = await db.all(`PRAGMA index_list('users')`);
  let referralUnique = false;
  for (const idx of idxList) {
    if (!idx.unique) continue;
    const info = await db.all(`PRAGMA index_info(${idx.name})`);
    if (info.some(i => i.name === 'referral_code')) {
      referralUnique = true;
      break;
    }
  }
  if (!referralUnique) rebuild = true;

  if (rebuild) {
    await db.exec('BEGIN');
    await db.exec(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT UNIQUE,
      xp INTEGER DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'Free',
      subscriptionTier TEXT DEFAULT 'Free',
      level INTEGER DEFAULT 1,
      levelName TEXT DEFAULT 'Shellborn',
      levelSymbol TEXT DEFAULT '🐚',
      levelProgress REAL DEFAULT 0,
      nextXP INTEGER DEFAULT 10000,
      twitterHandle TEXT,
      telegramId TEXT,
      telegramHandle TEXT,
      discordId TEXT,
      discordHandle TEXT,
      discordAccessToken TEXT,
      discordRefreshToken TEXT,
      discordTokenExpiresAt INTEGER,
      discordGuildMember INTEGER DEFAULT 0,
      referral_code TEXT,
      referred_by TEXT,
      telegram_username TEXT,
      twitter_username TEXT,
      twitter_id TEXT,
      discord_username TEXT,
      discord_id TEXT,
      socials TEXT,
      paid INTEGER DEFAULT 0,
      lastPaymentAt TEXT,
      subscriptionPaidAt TEXT,
      subscriptionClaimedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      UNIQUE(referral_code)
    );`);
    const existing = await db.all("PRAGMA table_info(users)");
    const have = new Set(existing.map(c => c.name));
    const cols = targetCols.map(([n]) => n).filter(n => have.has(n));
    const colsSql = cols.join(', ');
    if (cols.length) {
      await db.exec(`INSERT INTO users_new (${colsSql}) SELECT ${colsSql} FROM users;`);
    }
    await db.exec('DROP TABLE users;');
    await db.exec('ALTER TABLE users_new RENAME TO users;');
    await db.exec('COMMIT');
    console.log('Migration: rebuilt users table');
    await backfillUsersDefaults(db);
  }

  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet);');
}

export async function backfillUsersDefaults(db) {
  await db.run(`UPDATE users SET
    xp            = COALESCE(xp, 0),
    tier          = COALESCE(tier, 'Free'),
    subscriptionTier = COALESCE(subscriptionTier, tier, 'Free'),
    level         = COALESCE(level, 1),
    levelName     = COALESCE(levelName, 'Shellborn'),
    levelSymbol   = COALESCE(levelSymbol, '🐚'),
    levelProgress = COALESCE(levelProgress, 0),
    nextXP        = COALESCE(nextXP, 10000),
    socials       = COALESCE(socials, '{}'),
    discordGuildMember = COALESCE(discordGuildMember, 0),
    paid          = COALESCE(paid, 0),
    subscriptionPaidAt = COALESCE(subscriptionPaidAt, lastPaymentAt),
    createdAt     = COALESCE(createdAt, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updatedAt     = COALESCE(updatedAt, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `);

  const rows = await db.all("SELECT wallet, COALESCE(xp,0) AS xp FROM users");
  for (const row of rows) {
    const lvl = deriveLevel(row.xp || 0);
    await db.run(
      `UPDATE users
          SET levelName = ?,
              levelSymbol = ?,
              levelProgress = ?,
              nextXP = ?,
              updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE wallet = ?`,
      lvl.levelName,
      lvl.levelSymbol,
      lvl.progress,
      lvl.nextNeed,
      row.wallet
    );
  }
}

export default ensureUsersSchema;
