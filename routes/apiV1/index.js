import express from "express";
import tokenSaleRoutes from "./tokenSaleRoutes.js";
import subscriptionRoutes from "./subscriptionRoutes.js";

const router = express.Router();

router.use("/token-sale", tokenSaleRoutes);
router.use("/subscription", subscriptionRoutes);

export default router;
