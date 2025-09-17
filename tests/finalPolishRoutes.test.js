import request from "supertest";

let app;
let db;

beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  process.env.NODE_ENV = "test";
  process.env.TWITTER_CONSUMER_KEY = "test";
  process.env.TWITTER_CONSUMER_SECRET = "secret";
  process.env.FRONTEND_URL = "http://localhost:3000";
  ({ default: app } = await import("../server.js"));
  ({ default: db } = await import("../lib/db.js"));
});

afterAll(async () => {
  if (db) {
    await db.close();
  }
});

describe("session disconnect", () => {
  test("disconnect clears wallet from session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session/bind-wallet").send({ wallet: "wallet-disconnect" }).expect(200);

    const before = await agent.get("/api/users/me");
    expect(before.body.wallet).toBe("wallet-disconnect");
    expect(before.body.levelSymbol).toBe("🐚");

    const disconnectRes = await agent.post("/api/session/disconnect");
    expect(disconnectRes.body).toEqual({ ok: true });

    const after = await agent.get("/api/users/me");
    expect(after.body.wallet).toBeNull();
    expect(after.body.levelSymbol).toBe("🐚");
  });
});

describe("subscription claim", () => {
  test("awards xp once and is idempotent", async () => {
    const agent = request.agent(app);
    const wallet = "wallet-sub";
    await agent.post("/api/session/bind-wallet").send({ wallet }).expect(200);

    const first = await agent.post("/api/v1/subscription/claim");
    expect(first.body).toMatchObject({
      ok: true,
      xpDelta: 200,
      levelSymbol: "🌊",
      levelNumber: 2,
    });

    const second = await agent.post("/api/v1/subscription/claim");
    expect(second.body).toMatchObject({
      ok: true,
      xpDelta: 0,
      levelNumber: 2,
    });

    const row = await db.get("SELECT xp FROM users WHERE wallet = ?", wallet);
    expect(row?.xp).toBe(200);
  });
});

describe("referral claim", () => {
  test("grants bonus to referrer and clears cookie", async () => {
    await db.run(
      `INSERT OR IGNORE INTO users (wallet, referral_code, xp, updatedAt)
         VALUES ('referrer-wallet', 'REFCODE', 0, CURRENT_TIMESTAMP)`
    );

    const agent = request.agent(app);
    await agent.get("/ref/REFCODE").expect(302);
    await agent
      .post("/api/session/bind-wallet")
      .send({ wallet: "referred-wallet" })
      .expect(200);

    const first = await agent.post("/api/v1/referral/claim");
    expect(first.body).toMatchObject({
      ok: true,
      xpDelta: 50,
      levelSymbol: "🐚",
      levelNumber: 1,
    });

    const second = await agent.post("/api/v1/referral/claim");
    expect(second.body).toMatchObject({
      ok: true,
      xpDelta: 0,
      levelNumber: 1,
    });

    let referrer = await db.get(
      "SELECT xp FROM users WHERE wallet = ?",
      "referrer-wallet"
    );
    expect(referrer?.xp).toBe(50);

    const questRows = await db.all(
      "SELECT quest_id FROM completed_quests WHERE wallet = ? ORDER BY timestamp",
      "referrer-wallet"
    );
    expect(questRows).toHaveLength(1);
    expect(questRows[0]?.quest_id).toBe(
      "REFERRAL_BONUS:referrer-wallet:referred-wallet"
    );

    const secondAgent = request.agent(app);
    await secondAgent.get("/ref/REFCODE").expect(302);
    await secondAgent
      .post("/api/session/bind-wallet")
      .send({ wallet: "referred-wallet-2" })
      .expect(200);

    const third = await secondAgent.post("/api/v1/referral/claim");
    expect(third.body).toMatchObject({
      ok: true,
      xpDelta: 50,
      levelNumber: 2,
    });

    referrer = await db.get(
      "SELECT xp FROM users WHERE wallet = ?",
      "referrer-wallet"
    );
    expect(referrer?.xp).toBe(100);
  });
});

describe("social unlink", () => {
  test("clears provider data and socials json", async () => {
    const wallet = "social-wallet";
    const socialsJson = JSON.stringify({ twitter: { connected: true, handle: "cowrie" } });
    await db.run(
      `INSERT OR REPLACE INTO users (wallet, socials, twitterHandle, twitter_username, twitter_id, updatedAt)
         VALUES (?, ?, 'cowrie', 'cowrie', '123', CURRENT_TIMESTAMP)`,
      wallet,
      socialsJson
    );

    const agent = request.agent(app);
    await agent.post("/api/session/bind-wallet").send({ wallet }).expect(200);

    const res = await agent.post("/api/social/twitter/unlink");
    expect(res.body).toEqual({ ok: true });

    const row = await db.get(
      "SELECT socials, twitterHandle, twitter_username, twitter_id FROM users WHERE wallet = ?",
      wallet
    );
    expect(row.twitterHandle).toBeNull();
    expect(row.twitter_username).toBeNull();
    expect(row.twitter_id).toBeNull();
    const updatedSocials = JSON.parse(row.socials);
    expect(updatedSocials.twitter).toEqual({ connected: false });
  });
});
