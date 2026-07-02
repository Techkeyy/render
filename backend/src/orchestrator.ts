import express from "express";
import cors from "cors";
import { config, requireWallets } from "./config.ts";
import { AgentWallet } from "./lib/pay.ts";
import { runTask, type TaskEvent, type TaskInput } from "./runner.ts";
import authRouter, { verifyFundingTx } from "./auth.ts";

requireWallets();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);

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

// --- Watch mode (in-memory, max 5 active watches) ---
interface Watch {
  id: string;
  input: TaskInput;
  intervalMs: number;
  createdAt: number;
  lastRunAt: number | null;
  lastAnswer: string | null;
  currentAnswer: string | null;
  changed: boolean;
  runs: number;
  totalSpentUsdc: number;
  status: "active" | "done";
  ip: string;
  timer: ReturnType<typeof setInterval> | null;
}
const MAX_WATCHES = 5;
const MAX_WATCH_LIFETIME_MS = 6 * 60 * 60 * 1000;
const watches = new Map<string, Watch>();

function watchId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function runWatchCycle(w: Watch) {
  if (w.status !== "active") return;
  if (Date.now() - w.createdAt > MAX_WATCH_LIFETIME_MS) {
    w.status = "done";
    if (w.timer) clearInterval(w.timer);
    return;
  }
  try {
    let answer = "";
    let spent = 0;
    await runTask(w.input, (e) => {
      if (e.type === "paid") {
        stats.settledUsdc += e.paidUsdc;
        spent += e.paidUsdc;
      }
      if (e.type === "tipped") stats.tippedUsdc += e.tipUsdc;
      if (e.type === "answer") answer = e.answer;
    });
    w.lastAnswer = w.currentAnswer;
    w.currentAnswer = answer;
    w.changed = w.lastAnswer !== null && w.currentAnswer !== w.lastAnswer;
    w.runs++;
    w.totalSpentUsdc += spent;
    w.lastRunAt = Date.now();
    stats.errands++;
    stats.uniqueIps.add(w.ip);
  } catch (e) {
    console.warn(`watch ${w.id} cycle failed: ${(e as Error).message}`);
  }
}

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

// Funding transactions already consumed by a task — a tx id pays for one task only.
const usedFundingTxIds = new Set<string>();
const MIN_REFUND_USDC = 0.001;

app.post("/task", async (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const walletAddress = req.headers["x-wallet-address"] as string | undefined;
  const hasWallet = walletAddress && /^0x[0-9a-fA-F]{40}$/.test(walletAddress);
  if (!hasWallet && !checkRate(ip)) {
    return res.status(429).json({ error: "Rate limit — max 3 tasks per hour. Connect a wallet for unlimited access." });
  }
  try {
    const wallet = new AgentWallet(config.agentPrivateKey);
    const avail = await wallet.available();
    if (avail < MIN_BALANCE_USDC) {
      return res.status(503).json({ error: "The agent's wallet is running low. Please try again later." });
    }
  } catch { /* if balance check fails, let the task attempt anyway */ }

  const { goal, seedUrls, budgetUsdc, outputFields, fundingTxId } = req.body ?? {};
  if (typeof goal !== "string" || !goal.trim()) {
    return res.status(400).json({ error: "goal (string) is required" });
  }
  const input: TaskInput = {
    goal: goal.trim(),
    seedUrls: Array.isArray(seedUrls) ? seedUrls.filter((u: unknown) => typeof u === "string") : [],
    budgetUsdc: Number.isFinite(budgetUsdc) && budgetUsdc > 0 ? budgetUsdc : 0.02,
    outputFields: Array.isArray(outputFields) ? outputFields.filter((f: unknown) => typeof f === "string") : undefined,
  };

  // --- User-funded task: verify the user's USDC transfer to the agent before running ---
  const userToken = req.headers["x-user-token"] as string | undefined;
  let funding: { txId: string; from: `0x${string}`; amountUsdc: number } | null = null;
  if (typeof fundingTxId === "string" && fundingTxId && userToken) {
    if (usedFundingTxIds.has(fundingTxId)) {
      return res.status(402).json({ error: "This funding transaction was already used for a task." });
    }
    const v = await verifyFundingTx(userToken, fundingTxId, input.budgetUsdc);
    if (!v.ok) {
      return res.status(402).json({ error: `Funding check failed: ${v.reason}` });
    }
    usedFundingTxIds.add(fundingTxId);
    funding = { txId: fundingTxId, from: v.sourceAddress as `0x${string}`, amountUsdc: v.amountUsdc };
  }

  stats.errands++;
  stats.uniqueIps.add(ip);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let spentThisTask = 0;
  const send = (e: TaskEvent) => {
    if (e.type === "paid") {
      stats.settledUsdc += e.paidUsdc;
      spentThisTask += e.paidUsdc;
    }
    if (e.type === "tipped") {
      stats.tippedUsdc += e.tipUsdc;
      spentThisTask += e.tipUsdc;
    }
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  if (funding) {
    send({ type: "funded", amountUsdc: funding.amountUsdc, from: funding.from, txId: funding.txId });
  }

  try {
    await runTask(input, send);
  } catch (e) {
    send({ type: "error", error: (e as Error).message });
  } finally {
    // Return the unspent part of a user-funded budget to the user's wallet.
    if (funding) {
      const refund = Number((funding.amountUsdc - spentThisTask).toFixed(6));
      if (refund >= MIN_REFUND_USDC) {
        try {
          const wallet = new AgentWallet(config.agentPrivateKey);
          const txHash = await wallet.transferUsdc(funding.from, refund);
          send({ type: "refunded", amountUsdc: refund, to: funding.from, txHash });
        } catch (e) {
          console.error(`refund of ${refund} USDC to ${funding.from} failed:`, e);
          send({ type: "refunded", amountUsdc: refund, to: funding.from, txHash: null });
        }
      }
    }
    res.write("event: end\ndata: {}\n\n");
    res.end();
  }
});

// --- Watch endpoints ---

app.post("/watch", async (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (watches.size >= MAX_WATCHES) {
    return res.status(429).json({ error: `Max ${MAX_WATCHES} active watches. Cancel one first.` });
  }
  const { goal, seedUrls, budgetUsdc, intervalMin } = req.body ?? {};
  if (typeof goal !== "string" || !goal.trim()) {
    return res.status(400).json({ error: "goal (string) is required" });
  }
  const interval = [15, 30, 60].includes(Number(intervalMin)) ? Number(intervalMin) : 30;
  const input: TaskInput = {
    goal: goal.trim(),
    seedUrls: Array.isArray(seedUrls) ? seedUrls.filter((u: unknown) => typeof u === "string") : [],
    budgetUsdc: Number.isFinite(budgetUsdc) && budgetUsdc > 0 ? budgetUsdc : 0.02,
  };

  const id = watchId();
  const w: Watch = {
    id,
    input,
    intervalMs: interval * 60 * 1000,
    createdAt: Date.now(),
    lastRunAt: null,
    lastAnswer: null,
    currentAnswer: null,
    changed: false,
    runs: 0,
    totalSpentUsdc: 0,
    status: "active",
    ip,
    timer: null,
  };
  watches.set(id, w);

  // First run immediately
  await runWatchCycle(w);

  // Schedule recurring runs
  w.timer = setInterval(() => runWatchCycle(w), w.intervalMs);

  res.json({
    id: w.id,
    status: w.status,
    currentAnswer: w.currentAnswer,
    runs: w.runs,
    nextRunAt: Date.now() + w.intervalMs,
  });
});

app.get("/watches", (_req, res) => {
  const list = [...watches.values()].map((w) => ({
    id: w.id,
    goal: w.input.goal,
    status: w.status,
    changed: w.changed,
    currentAnswer: w.currentAnswer,
    runs: w.runs,
    totalSpentUsdc: Number(w.totalSpentUsdc.toFixed(6)),
    intervalMin: w.intervalMs / 60000,
    lastRunAt: w.lastRunAt,
    nextRunAt: w.status === "active" ? (w.lastRunAt ?? w.createdAt) + w.intervalMs : null,
  }));
  res.json(list);
});

app.get("/watch/:id", (req, res) => {
  const w = watches.get(req.params.id);
  if (!w) return res.status(404).json({ error: "watch not found" });
  res.json({
    id: w.id,
    goal: w.input.goal,
    status: w.status,
    changed: w.changed,
    lastAnswer: w.lastAnswer,
    currentAnswer: w.currentAnswer,
    runs: w.runs,
    totalSpentUsdc: Number(w.totalSpentUsdc.toFixed(6)),
    intervalMin: w.intervalMs / 60000,
    lastRunAt: w.lastRunAt,
    nextRunAt: w.status === "active" ? (w.lastRunAt ?? w.createdAt) + w.intervalMs : null,
  });
});

app.delete("/watch/:id", (req, res) => {
  const w = watches.get(req.params.id);
  if (!w) return res.status(404).json({ error: "watch not found" });
  if (w.timer) clearInterval(w.timer);
  w.status = "done";
  watches.delete(w.id);
  res.json({ cancelled: true, id: w.id, runs: w.runs, totalSpentUsdc: Number(w.totalSpentUsdc.toFixed(6)) });
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
