import request from "supertest";

let app;
let db;

beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  process.env.NODE_ENV = "test";
  process.env.FRONTEND_URL = "http://localhost:3000";
  process.env.TWITTER_CONSUMER_KEY = "test";
  process.env.TWITTER_CONSUMER_SECRET = "secret";
  ({ default: app } = await import("../server.js"));
  ({ default: db } = await import("../lib/db.js"));
});

afterAll(async () => {
  if (db) {
    await db.close();
  }
});

describe("Social unlink", () => {
  it("401 without session wallet", async () => {
    const res = await request(app).post("/api/social/twitter/unlink");
    expect(res.status).toBe(401);
  });
});
