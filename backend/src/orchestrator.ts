import express from "express";
import cors from "cors";
import { config, requireWallets } from "./config.ts";
import { AgentWallet } from "./lib/pay.ts";
import { runTask, type TaskEvent, type TaskInput } from "./runner.ts";
import authRouter, { verifyFundingTx } from "./auth.ts";
import { loadStore, store, storeBackend, type TaskRecord, type WatchRecord } from "./store.ts";
import { verifyPublisherFile } from "./publishers.ts";

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

// --- Live stats (persisted via store.ts — survives restarts, and redeploys with Upstash) ---
function bumpStats(ip: string) {
  store.data.stats.errands++;
  if (!store.data.stats.users.includes(ip)) store.data.stats.users.push(ip);
  store.touch();
}

/** Username from the x-render-user header (or a query param) — display identity only. */
function sanitizeUser(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z0-9_.-]{1,32}$/.test(s) ? s : null;
}

// --- Watch mode (records persisted in the store; timers rebuilt on boot) ---
const MAX_WATCHES = 5;
const MAX_WATCH_LIFETIME_MS = 6 * 60 * 60 * 1000;
const watchTimers = new Map<string, ReturnType<typeof setInterval>>();

function watchId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getWatch(id: string): WatchRecord | undefined {
  return store.data.watches.find((w) => w.id === id);
}

function scheduleWatch(w: WatchRecord) {
  watchTimers.set(w.id, setInterval(() => runWatchCycle(w), w.intervalMs));
}

function stopWatchTimer(id: string) {
  const t = watchTimers.get(id);
  if (t) clearInterval(t);
  watchTimers.delete(id);
}

async function runWatchCycle(w: WatchRecord) {
  if (w.status !== "active") return;
  if (Date.now() - w.createdAt > MAX_WATCH_LIFETIME_MS) {
    w.status = "done";
    stopWatchTimer(w.id);
    store.touch();
    return;
  }
  try {
    let answer = "";
    let spent = 0;
    await runTask(w.input, (e) => {
      if (e.type === "paid") {
        store.data.stats.settledUsdc += e.paidUsdc;
        spent += e.paidUsdc;
      }
      if (e.type === "tipped") store.data.stats.tippedUsdc += e.tipUsdc;
      if (e.type === "answer") answer = e.answer;
    });
    w.lastAnswer = w.currentAnswer;
    w.currentAnswer = answer;
    w.changed = w.lastAnswer !== null && w.currentAnswer !== w.lastAnswer;
    w.runs++;
    w.totalSpentUsdc += spent;
    w.lastRunAt = Date.now();
    bumpStats(w.ip);
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
  res.json({ ok: true, service: "orchestrator", agent: config.agentAddress, renderService: config.renderServiceUrl, store: storeBackend() }),
);

app.get("/stats", (_req, res) =>
  res.json({
    errands: store.data.stats.errands,
    users: store.data.stats.users.length,
    settledUsdc: Number(store.data.stats.settledUsdc.toFixed(6)),
    tippedUsdc: Number(store.data.stats.tippedUsdc.toFixed(6)),
  }),
);

// Past errands for a signed-in user: goal, answer, receipt — their account history.
app.get("/history", (req, res) => {
  const user = sanitizeUser(req.query.user);
  if (!user) return res.status(400).json({ error: "user query param required" });
  res.json(store.data.tasks.filter((t) => t.user === user).slice(0, 20));
});

// Publisher onboarding: live check of a domain's /.well-known/x402.json.
app.get("/publishers/verify", async (req, res) => {
  const domain = String(req.query.domain ?? "").trim();
  if (!domain) return res.status(400).json({ error: "domain query param required" });
  res.json(await verifyPublisherFile(domain));
});

// Publisher leaderboard: tips actually paid out, aggregated from the ledger.
app.get("/publishers/leaderboard", (_req, res) => {
  const totals = new Map<string, { publisher: string; tips: number; totalUsdc: number }>();
  for (const t of store.data.tasks) {
    for (const r of t.receipt) {
      if (!r.title.startsWith("tip → ")) continue;
      const name = r.title.slice("tip → ".length);
      const row = totals.get(name) ?? { publisher: name, tips: 0, totalUsdc: 0 };
      row.tips++;
      row.totalUsdc += r.paidUsdc;
      totals.set(name, row);
    }
  }
  const list = [...totals.values()]
    .map((r) => ({ ...r, totalUsdc: Number(r.totalUsdc.toFixed(6)) }))
    .sort((a, b) => b.totalUsdc - a.totalUsdc)
    .slice(0, 20);
  res.json(list);
});

// One completed errand by id — powers the public share permalink (/r/:id on the frontend).
// The owner's username stays private; everything else on the receipt is already public on-chain.
app.get("/errand/:id", (req, res) => {
  const t = store.data.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "errand not found" });
  const { user: _user, ...pub } = t;
  res.json(pub);
});

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
// Anonymous errands spend the agent's shared wallet, so they stay small.
// Signed-in users fund their own errands, so their ceiling matches /auth/fund's cap.
const MAX_BUDGET_ANON = 0.02;
const MAX_BUDGET_WALLET = 0.5;

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

  const maxBudget = hasWallet ? MAX_BUDGET_WALLET : MAX_BUDGET_ANON;
  if (input.budgetUsdc > maxBudget) {
    return res.status(400).json({
      error: hasWallet
        ? `Budget is capped at $${MAX_BUDGET_WALLET.toFixed(2)} per errand.`
        : `Anonymous errands are capped at $${MAX_BUDGET_ANON.toFixed(2)} — sign in to run bigger ones on your own wallet.`,
    });
  }

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

  bumpStats(ip);
  const username = sanitizeUser(req.headers["x-render-user"]);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let spentThisTask = 0;
  let tippedThisTask = 0;
  let answerEvent: Extract<TaskEvent, { type: "answer" }> | null = null;
  const send = (e: TaskEvent) => {
    if (e.type === "paid") {
      store.data.stats.settledUsdc += e.paidUsdc;
      spentThisTask += e.paidUsdc;
    }
    if (e.type === "tipped") {
      store.data.stats.tippedUsdc += e.tipUsdc;
      spentThisTask += e.tipUsdc;
      tippedThisTask += e.tipUsdc;
    }
    if (e.type === "answer") answerEvent = e;
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
    // Record the errand in the account history (and the anonymous ledger).
    // (snapshot: TS can't see the assignment inside the send closure)
    const a = answerEvent as Extract<TaskEvent, { type: "answer" }> | null;
    const record: TaskRecord = {
      id: watchId(),
      user: username,
      goal: input.goal,
      answer: a?.answer ?? null,
      confidence: a?.confidence ?? null,
      spentUsdc: Number(spentThisTask.toFixed(6)),
      tippedUsdc: Number(tippedThisTask.toFixed(6)),
      funded: !!funding,
      receipt: a?.receipt ?? [],
      sources: a?.sources ?? [],
      createdAt: Date.now(),
    };
    store.data.tasks.unshift(record);
    store.touch();
    send({ type: "recorded", id: record.id });
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

function watchSummary(w: WatchRecord) {
  return {
    id: w.id,
    goal: w.input.goal,
    owner: w.owner,
    status: w.status,
    changed: w.changed,
    currentAnswer: w.currentAnswer,
    runs: w.runs,
    totalSpentUsdc: Number(w.totalSpentUsdc.toFixed(6)),
    intervalMin: w.intervalMs / 60000,
    lastRunAt: w.lastRunAt,
    nextRunAt: w.status === "active" ? (w.lastRunAt ?? w.createdAt) + w.intervalMs : null,
  };
}

app.post("/watch", async (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const active = store.data.watches.filter((w) => w.status === "active");
  if (active.length >= MAX_WATCHES) {
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

  const w: WatchRecord = {
    id: watchId(),
    owner: sanitizeUser(req.headers["x-render-user"]),
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
  };
  store.data.watches.push(w);
  store.touch();

  // First run immediately, then recurring
  await runWatchCycle(w);
  scheduleWatch(w);

  res.json({
    id: w.id,
    status: w.status,
    currentAnswer: w.currentAnswer,
    runs: w.runs,
    nextRunAt: Date.now() + w.intervalMs,
  });
});

app.get("/watches", (req, res) => {
  const user = sanitizeUser(req.query.user);
  const list = store.data.watches
    .filter((w) => (user ? w.owner === user : true))
    .map(watchSummary);
  res.json(list);
});

app.get("/watch/:id", (req, res) => {
  const w = getWatch(req.params.id);
  if (!w) return res.status(404).json({ error: "watch not found" });
  res.json({ ...watchSummary(w), lastAnswer: w.lastAnswer });
});

app.delete("/watch/:id", (req, res) => {
  const w = getWatch(req.params.id);
  if (!w) return res.status(404).json({ error: "watch not found" });
  // Account-owned watches can only be cancelled by their owner.
  if (w.owner && w.owner !== sanitizeUser(req.headers["x-render-user"])) {
    return res.status(403).json({ error: "This watch belongs to another account." });
  }
  stopWatchTimer(w.id);
  store.data.watches = store.data.watches.filter((x) => x.id !== w.id);
  store.touch();
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
  await loadStore();
  // Resume watches that were active before the restart.
  let resumed = 0;
  for (const w of store.data.watches) {
    if (w.status !== "active") continue;
    if (Date.now() - w.createdAt > MAX_WATCH_LIFETIME_MS) {
      w.status = "done";
      continue;
    }
    scheduleWatch(w);
    resumed++;
  }
  if (resumed) console.log(`  watches        : resumed ${resumed}`);
  store.touch();
  await ensureFunded();
});
