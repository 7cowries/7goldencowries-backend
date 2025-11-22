import authRoutes from "./authRoutes.js";
import questRoutes from "./questRoutes.js";
import userRoutes from "./userRoutes.js";
import verifyRoutes from "./verifyRoutes.js";
import tonWebhook from "./tonWebhook.js";
import referralRoutes from "./referralRoutes.js";
import refRedirectRoutes from "./refRedirectRoutes.js";
import twitterRoutes from "./twitterRoutes.js";
import tokenSaleRoutes from "./tokenSaleRoutes.js";
import questLinkRoutes from "./questLinkRoutes.js";
import questTelegramRoutes from "./questTelegramRoutes.js";
import questDiscordRoutes from "./questDiscordRoutes.js";
import socialLinkRoutes from "./socialLinkRoutes.js";
import proofRoutes from "./proofRoutes.js";
import healthRoutes from "./healthRoutes.js";
import apiV1Routes from "./apiV1/index.js";
import historyRoutes from "./historyRoutes.js";
import leaderboardRoutes from "./leaderboardRoutes.js";
import telegramRoutes from "./telegramRoutes.js";

const canonicalRouters = [
  { router: telegramRoutes },
  { router: authRoutes },
  { router: questLinkRoutes },
  { router: questTelegramRoutes },
  { router: questDiscordRoutes },
  { router: socialLinkRoutes },
  { router: questRoutes },
  { router: userRoutes },
  { router: verifyRoutes },
  { router: tonWebhook },
  { router: referralRoutes },
  { router: refRedirectRoutes },
  { path: "/api/proofs", router: proofRoutes },
  { path: "/api", router: twitterRoutes },
  { router: tokenSaleRoutes },
  { path: "/api/v1", router: apiV1Routes },
  { router: historyRoutes },
  { path: "/api/leaderboard", router: leaderboardRoutes },
  { router: healthRoutes },
];

export default canonicalRouters;
