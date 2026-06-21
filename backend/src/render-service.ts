import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { formatUnits } from "viem";
import { config } from "./config.ts";
import { renderPage, assertSafeUrl, closeBrowser } from "./lib/render.ts";

type PaidRequest = express.Request & {
  payment?: { verified: boolean; payer: string; amount: string; network: string; transaction?: string };
};

if (!config.sellerAddress) {
  console.error("Missing SELLER_ADDRESS. Run `npm run generate-wallets` first.");
  process.exit(1);
}

const app = express();
app.use(express.json());

const gateway = createGatewayMiddleware({
  sellerAddress: config.sellerAddress,
  facilitatorUrl: config.gatewayFacilitator,
  networks: [config.network],
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "render-service", seller: config.sellerAddress, price: config.renderPrice }),
);

/**
 * The paid endpoint. Pay $0.001 in USDC (handled by the Gateway middleware),
 * and get back the fully-rendered, human-visible text of a page.
 */
app.get("/render", gateway.require(config.renderPrice), async (req: PaidRequest, res) => {
  const raw = String(req.query.url ?? "");
  try {
    assertSafeUrl(raw); // reject internal targets before we spend any compute
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  const pay = req.payment;
  const paidUsdc = pay ? formatUnits(BigInt(pay.amount), 6) : "0";
  console.log(`fare ${paidUsdc} USDC from ${pay?.payer ?? "?"} -> render ${raw}`);

  try {
    const result = await renderPage(raw);
    res.json({
      ...result,
      _payment: {
        payer: pay?.payer ?? null,
        amountUsdc: paidUsdc,
        network: pay?.network ?? config.network,
        settlementId: pay?.transaction ?? null,
      },
    });
  } catch (e) {
    // Render failed after payment. For the MVP we surface the error; a production
    // build would void/refund the fare here.
    console.error(`render failed for ${raw}: ${(e as Error).message}`);
    res.status(502).json({ error: `render failed: ${(e as Error).message}`, url: raw });
  }
});

const server = app.listen(config.renderServicePort, () => {
  console.log(`render-service listening on http://localhost:${config.renderServicePort}`);
  console.log(`  seller : ${config.sellerAddress}`);
  console.log(`  price  : ${config.renderPrice} per page`);
});

async function shutdown() {
  console.log("\nshutting down render-service...");
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
