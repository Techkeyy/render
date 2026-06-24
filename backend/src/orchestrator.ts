import express from "express";
import cors from "cors";
import { config, requireWallets } from "./config.ts";
import { AgentWallet } from "./lib/pay.ts";
import { runTask, type TaskEvent, type TaskInput } from "./runner.ts";

requireWallets();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

// --- Rate limiting (in-memory, per-IP) ---
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MIN_BALANCE_USDC = 0.05;
const ipHits = new Map<string, number[]>();

// --- Live stats (in-memory — resets on deploy, which is fine for a hackathon) ---
const stats = {
  errands: 0,
  uniqueIps: new Set<string>(),
  settledUsdc: 0,
  tippedUsdc: 0,
};

function checkRate(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "orchestrator", agent: config.agentAddress, renderService: config.renderServiceUrl }),
);

app.get("/stats", (_req, res) =>
  res.json({
    errands: stats.errands,
    users: stats.uniqueIps.size,
    settledUsdc: Number(stats.settledUsdc.toFixed(6)),
    tippedUsdc: Number(stats.tippedUsdc.toFixed(6)),
  }),
);

// Current spendable balance inside the agent's Gateway wallet.
app.get("/balance", async (_req, res) => {
  try {
    const wallet = new AgentWallet(config.agentPrivateKey);
    const b = await wallet.balances();
    res.json({
      gatewayAvailableUsdc: b.gateway.formattedAvailable,
      walletUsdc: b.wallet?.formatted ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/task", async (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRate(ip)) {
    return res.status(429).json({ error: "Rate limit — max 3 tasks per hour. Try again later." });
  }
  try {
    const wallet = new AgentWallet(config.agentPrivateKey);
    const avail = await wallet.available();
    if (avail < MIN_BALANCE_USDC) {
      return res.status(503).json({ error: "The agent's wallet is running low. Please try again later." });
    }
  } catch { /* if balance check fails, let the task attempt anyway */ }

  const { goal, seedUrls, budgetUsdc } = req.body ?? {};
  if (typeof goal !== "string" || !goal.trim()) {
    return res.status(400).json({ error: "goal (string) is required" });
  }
  const input: TaskInput = {
    goal: goal.trim(),
    seedUrls: Array.isArray(seedUrls) ? seedUrls.filter((u: unknown) => typeof u === "string") : [],
    budgetUsdc: Number.isFinite(budgetUsdc) && budgetUsdc > 0 ? budgetUsdc : 0.02,
  };

  stats.errands++;
  stats.uniqueIps.add(ip);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (e: TaskEvent) => {
    if (e.type === "paid") stats.settledUsdc += e.paidUsdc;
    if (e.type === "tipped") stats.tippedUsdc += e.tipUsdc;
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  try {
    await runTask(input, send);
  } catch (e) {
    send({ type: "error", error: (e as Error).message });
  } finally {
    res.write("event: end\ndata: {}\n\n");
    res.end();
  }
});

// Make sure the Gateway wallet has spendable USDC before serving traffic.
async function ensureFunded() {
  const wallet = new AgentWallet(config.agentPrivateKey);
  try {
    const available = await wallet.available();
    console.log(`agent Gateway balance: ${available} USDC`);
    if (available < config.renderPriceUsdc * 20) {
      console.log("Gateway balance low — depositing 1 USDC from the agent wallet...");
      const tx = await wallet.deposit("1");
      console.log(`deposit tx: ${tx}`);
    }
  } catch (e) {
    console.warn(
      `Could not confirm/deposit Gateway balance: ${(e as Error).message}\n` +
        `Fund the agent wallet (${config.agentAddress}) with Arc Testnet USDC at https://faucet.circle.com/`,
    );
  }
}

app.listen(config.orchestratorPort, async () => {
  console.log(`orchestrator listening on http://localhost:${config.orchestratorPort}`);
  console.log(`  agent          : ${config.agentAddress}`);
  console.log(`  render service : ${config.renderServiceUrl}`);
  console.log(`  plan model     : ${config.modelPlan}   loop model: ${config.modelLoop}`);
  await ensureFunded();
});
