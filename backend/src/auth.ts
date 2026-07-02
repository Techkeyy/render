import { Router } from "express";
import crypto from "crypto";
import { config } from "./config.ts";
import { store } from "./store.ts";

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

// username → Circle userId, persisted in the store so accounts survive redeploys.
const accounts = {
  has: (u: string) => u in store.data.accounts,
  get: (u: string) => store.data.accounts[u],
  set: (u: string, id: string) => {
    store.data.accounts[u] = id;
    store.touch();
  },
};

router.post("/token", requireCircle, async (req, res) => {
  const client = await getClient();
  if (!client) return res.status(503).json({ error: "Circle client unavailable" });

  const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const loginOnly = req.body?.login === true;

  try {
    if (loginOnly && username && !accounts.has(username)) {
      return res.status(404).json({ error: "No account found. Create one first." });
    }

    let userId: string;
    let returning = false;

    if (username && accounts.has(username)) {
      userId = accounts.get(username)!;
      returning = true;
    } else {
      userId = `render_${crypto.randomUUID()}`;
      await client.createUser({ userId });
      if (username) accounts.set(username, userId);
    }

    const tokenResponse = await client.createUserToken({ userId });
    const { userToken, encryptionKey } = tokenResponse.data!;

    res.json({ userId, userToken, encryptionKey, returning });
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

// --- Task funding: the signed-in user's wallet pays the agent for the errand ---

const MAX_FUND_USDC = 0.5;

/**
 * Start a user-initiated USDC transfer from the user's wallet to the agent's
 * wallet. Returns a challengeId the frontend passes to the Circle web SDK —
 * the user approves the exact amount with their PIN. Nothing moves without it.
 */
router.post("/fund", requireCircle, async (req, res) => {
  const client = await getClient();
  if (!client) return res.status(503).json({ error: "Circle client unavailable" });

  const userToken = req.headers["x-user-token"] as string;
  if (!userToken) return res.status(400).json({ error: "x-user-token header required" });

  const { walletId, amount } = req.body ?? {};
  const usdc = Number(amount);
  if (typeof walletId !== "string" || !walletId) return res.status(400).json({ error: "walletId required" });
  if (!Number.isFinite(usdc) || usdc <= 0 || usdc > MAX_FUND_USDC) {
    return res.status(400).json({ error: `amount must be between 0 and ${MAX_FUND_USDC} USDC` });
  }

  const refId = `fund_${crypto.randomUUID()}`;
  try {
    const response = await client.createTransaction({
      userToken,
      walletId,
      amounts: [usdc.toFixed(6)],
      destinationAddress: config.agentAddress,
      tokenAddress: config.usdcAddress,
      blockchain: "ARC-TESTNET",
      refId,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    res.json({ challengeId: response.data?.challengeId, refId });
  } catch (e) {
    console.error("auth/fund error:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Poll the state of a funding transfer by refId. The frontend calls this after
 * the PIN challenge until the transfer confirms, then starts the task with the
 * returned transaction id.
 */
router.get("/fund/status", requireCircle, async (req, res) => {
  const client = await getClient();
  if (!client) return res.status(503).json({ error: "Circle client unavailable" });

  const userToken = req.headers["x-user-token"] as string;
  if (!userToken) return res.status(400).json({ error: "x-user-token header required" });
  const refId = String(req.query.refId ?? "");
  if (!refId) return res.status(400).json({ error: "refId query param required" });

  try {
    const response = await client.listTransactions({
      userToken,
      destinationAddress: config.agentAddress,
    });
    const tx = (response.data?.transactions ?? []).find((t) => t.refId === refId);
    if (!tx) return res.json({ state: "PENDING" });
    res.json({ state: tx.state, txId: tx.id, txHash: tx.txHash ?? null, amounts: tx.amounts ?? [] });
  } catch (e) {
    console.error("auth/fund/status error:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Server-side check used by the orchestrator: is this Circle transaction a
 * confirmed USDC transfer to the agent's wallet covering the given amount?
 */
export async function verifyFundingTx(
  userToken: string,
  txId: string,
  minAmountUsdc: number,
): Promise<{ ok: true; sourceAddress: string; amountUsdc: number } | { ok: false; reason: string }> {
  const client = await getClient();
  if (!client) return { ok: false, reason: "Circle client unavailable" };
  try {
    const response = await client.getTransaction({ userToken, id: txId });
    const tx = response.data?.transaction;
    if (!tx) return { ok: false, reason: "funding transaction not found" };
    if (tx.destinationAddress?.toLowerCase() !== config.agentAddress.toLowerCase()) {
      return { ok: false, reason: "funding transaction does not pay the agent" };
    }
    if (tx.state !== "CONFIRMED" && tx.state !== "COMPLETE") {
      return { ok: false, reason: `funding transaction not confirmed (state: ${tx.state})` };
    }
    const amount = Number(tx.amounts?.[0] ?? 0);
    if (!(amount >= minAmountUsdc - 1e-9)) {
      return { ok: false, reason: `funding amount ${amount} is below the task budget ${minAmountUsdc}` };
    }
    const sourceAddress = tx.sourceAddress ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(sourceAddress)) {
      return { ok: false, reason: "funding transaction has no source address to refund" };
    }
    return { ok: true, sourceAddress, amountUsdc: amount };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

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
