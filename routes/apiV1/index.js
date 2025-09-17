import express from "express";
import tokenSaleRoutes from "./tokenSaleRoutes.js";
import subscriptionRoutes from "./subscriptionRoutes.js";
import referralRoutes from "./referralRoutes.js";
import paymentsRoutes from "./paymentsRoutes.js";

const router = express.Router();

router.use("/token-sale", tokenSaleRoutes);
router.use("/subscription", subscriptionRoutes);
router.use("/referral", referralRoutes);
router.use("/payments", paymentsRoutes);

export default router;
