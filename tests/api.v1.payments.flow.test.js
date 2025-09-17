import request from "supertest";
import { jest } from "@jest/globals";

let app;
let db;
let verifyTonMock;

beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  process.env.NODE_ENV = "test";
  process.env.FRONTEND_URL = "http://localhost:3000";
  process.env.SESSION_SECRET = "test-secret";
  process.env.TON_RECEIVE_ADDRESS = "EQTestReceive";
  process.env.TON_VERIFIER = "toncenter";
  process.env.SUBSCRIPTION_BONUS_XP = "120";
  verifyTonMock = jest.fn();
  jest.unstable_mockModule("../lib/ton.js", () => ({
    verifyTonPayment: verifyTonMock,
    default: { verifyTonPayment: verifyTonMock },
  }));

  ({ default: app } = await import("../server.js"));
  ({ default: db } = await import("../lib/db.js"));
});

afterAll(async () => {
  if (db) {
    await db.close();
  }
});

test("ton payment verification unlocks subscription claim", async () => {
  const agent = request.agent(app);
  await agent.post("/api/session/bind-wallet").send({ wallet: "EQWallet123" });

  let res = await agent.get("/api/v1/payments/status");
  expect(res.status).toBe(200);
  expect(res.body.paid).toBe(false);

  verifyTonMock.mockResolvedValueOnce({
    verified: true,
    amount: 12,
    to: "EQTestReceive",
    comment: "7GC-SUB:123456",
  });

  res = await agent
    .post("/api/v1/payments/verify")
    .send({ txHash: "0xabc", amount: 12, to: "EQTestReceive", comment: "7GC-SUB:123456" });
  expect(res.status).toBe(200);
  expect(res.body.verified).toBe(true);
  expect(verifyTonMock).toHaveBeenCalledWith({
    txHash: "0xabc",
    to: "EQTestReceive",
    minAmount: expect.any(Number),
    comment: "7GC-SUB",
  });

  res = await agent.get("/api/v1/payments/status");
  expect(res.status).toBe(200);
  expect(res.body.paid).toBe(true);

  res = await agent.get("/api/v1/subscription/status");
  expect(res.status).toBe(200);
  expect(res.body.paid).toBe(true);
  expect(res.body.canClaim).toBe(true);
  expect(res.body.bonusXp).toBe(120);

  res = await agent.post("/api/v1/subscription/claim");
  expect(res.status).toBe(200);
  expect(res.body.xpDelta).toBe(120);
  expect(res.body.claimedAt).toBeTruthy();

  res = await agent.post("/api/v1/subscription/claim");
  expect(res.status).toBe(200);
  expect(res.body.xpDelta).toBe(0);
});
