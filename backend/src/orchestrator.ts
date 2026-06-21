import express from "express";
import cors from "cors";
import { config, requireWallets } from "./config.ts";
import { AgentWallet } from "./lib/pay.ts";
import { runTask, type TaskEvent, type TaskInput } from "./runner.ts";

/**
 * The HTTP API the frontend talks to. One endpoint runs an errand and streams
 * the live receipt back as Server-Sent Events, so the browser can render each
 * fare as it's paid.
 */

requireWallets();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "orchestrator", agent: config.agentAddress, renderService: config.renderServiceUrl }),
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

// Run an errand. Streams TaskEvents as SSE; the final "answer" event carries the receipt.
app.post("/task", async (req, res) => {
  const { goal, seedUrls, budgetUsdc } = req.body ?? {};
  if (typeof goal !== "string" || !goal.trim()) {
    return res.status(400).json({ error: "goal (string) is required" });
  }
  const input: TaskInput = {
    goal: goal.trim(),
    seedUrls: Array.isArray(seedUrls) ? seedUrls.filter((u: unknown) => typeof u === "string") : [],
    budgetUsdc: Number.isFinite(budgetUsdc) && budgetUsdc > 0 ? budgetUsdc : 0.02,
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (e: TaskEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

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
