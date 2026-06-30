import { Router } from "express";
import crypto from "crypto";
import { config } from "./config.ts";

const router = Router();

let circleClient: ReturnType<typeof import("@circle-fin/user-controlled-wallets").initiateUserControlledWalletsClient> | null = null;

async function getClient() {
  if (circleClient) return circleClient;
  if (!config.circleApiKey) return null;
  const { initiateUserControlledWalletsClient } = await import("@circle-fin/user-controlled-wallets");
  circleClient = initiateUserControlledWalletsClient({ apiKey: config.circleApiKey });
  return circleClient;
}

function requireCircle(_req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (!config.circleApiKey) return res.status(503).json({ error: "Circle Wallets SDK not configured. Set CIRCLE_API_KEY." });
  next();
}

function idempotencyKey(): string {
  return crypto.randomUUID();
}

router.post("/token", requireCircle, async (req, res) => {
  const client = await getClient();
  if (!client) return res.status(503).json({ error: "Circle client unavailable" });

  try {
    const existing = typeof req.body?.userId === "string" && req.body.userId.startsWith("render_");
    const userId = existing ? req.body.userId : `render_${crypto.randomUUID()}`;
    if (!existing) await client.createUser({ userId });
    const tokenResponse = await client.createUserToken({ userId });
    const { userToken, encryptionKey } = tokenResponse.data!;

    res.json({ userId, userToken, encryptionKey, returning: existing });
  } catch (e) {
    console.error("auth/token error:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/init", requireCircle, async (req, res) => {
  const client = await getClient();
  if (!client) return res.status(503).json({ error: "Circle client unavailable" });

  const { userToken } = req.body;
  if (!userToken) return res.status(400).json({ error: "userToken required" });

  try {
    const response = await client.createUserPinWithWallets({
      userToken,
      blockchains: ["ARC-TESTNET"],
      accountType: "SCA",
    });
    res.json({ challengeId: response.data?.challengeId });
  } catch (e) {
    console.error("auth/init error:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/wallets", requireCircle, async (req, res) => {
  const client = await getClient();
  if (!client) return res.status(503).json({ error: "Circle client unavailable" });

  const userToken = req.headers["x-user-token"] as string;
  if (!userToken) return res.status(400).json({ error: "x-user-token header required" });

  try {
    const response = await client.listWallets({ userToken });
    res.json({ wallets: response.data?.wallets ?? [] });
  } catch (e) {
    console.error("auth/wallets error:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/balance/:walletId", requireCircle, async (req, res) => {
  const client = await getClient();
  if (!client) return res.status(503).json({ error: "Circle client unavailable" });

  const userToken = req.headers["x-user-token"] as string;
  if (!userToken) return res.status(400).json({ error: "x-user-token header required" });

  try {
    const response = await client.getWalletTokenBalance({
      userToken,
      walletId: String(req.params.walletId),
    });
    res.json({ balances: response.data?.tokenBalances ?? [] });
  } catch (e) {
    console.error("auth/balance error:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/configured", (_req, res) => {
  res.json({ configured: !!config.circleApiKey });
});

export default router;
