import dotenv from "dotenv";
// Load .env.local first (where generate-wallets writes), then .env as a fallback.
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Arc Testnet + Circle Gateway constants.
 * Values verified against circlefin/arc-nanopayments and the-canteen-dev/circle-agent.
 */
export const config = {
  // --- Arc Testnet network ---
  arcRpc: process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network",
  arcExplorer: process.env.ARC_EXPLORER ?? "https://testnet.arcscan.app",
  // ERC-20 USDC on Arc Testnet (6 decimals)
  usdcAddress: "0x3600000000000000000000000000000000000000" as `0x${string}`,
  // CAIP-2 network id used by the Gateway middleware
  network: "eip155:5042002" as const,
  // GatewayClient chain key (viem chain name)
  chainKey: "arcTestnet" as const,

  // --- Circle Gateway (x402 batching facilitator) ---
  gatewayFacilitator: process.env.GATEWAY_FACILITATOR ?? "https://gateway-api-testnet.circle.com",

  // --- Wallets (populated by `npm run generate-wallets`, then funded via faucet) ---
  sellerAddress: (process.env.SELLER_ADDRESS ?? "") as `0x${string}`,
  sellerPrivateKey: (process.env.SELLER_PRIVATE_KEY ?? "") as `0x${string}`,
  agentAddress: (process.env.AGENT_ADDRESS ?? "") as `0x${string}`,
  agentPrivateKey: (process.env.AGENT_PRIVATE_KEY ?? "") as `0x${string}`,

  // --- Pricing ---
  // What the render service charges per page it opens. Sub-cent — below any card floor.
  renderPrice: process.env.RENDER_PRICE ?? "$0.001",
  renderPriceUsdc: Number(process.env.RENDER_PRICE_USDC ?? "0.001"),

  // --- Service endpoints ---
  renderServicePort: Number(process.env.RENDER_SERVICE_PORT ?? 4000),
  renderServiceUrl: process.env.RENDER_SERVICE_URL ?? "http://localhost:4000",
  // Render/PaaS inject PORT; the orchestrator is the public service so it binds it.
  orchestratorPort: Number(process.env.ORCHESTRATOR_PORT ?? process.env.PORT ?? 4100),

  // --- Agent brain (OpenAI-compatible; defaults to DeepSeek) ---
  llmApiKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "https://api.deepseek.com",
  // Model for the per-page decide/extract loop, and for plan + synthesis.
  modelLoop: process.env.MODEL_LOOP ?? "deepseek-chat",
  modelPlan: process.env.MODEL_PLAN ?? "deepseek-chat",

  // --- Safety caps ---
  maxPagesPerTask: Number(process.env.MAX_PAGES_PER_TASK ?? 12),
  renderTimeoutMs: Number(process.env.RENDER_TIMEOUT_MS ?? 22000),
} as const;

export function requireWallets() {
  const missing: string[] = [];
  if (!config.sellerAddress) missing.push("SELLER_ADDRESS");
  if (!config.agentPrivateKey) missing.push("AGENT_PRIVATE_KEY");
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(", ")} in .env.local. Run \`npm run generate-wallets\` first, then fund the agent wallet at https://faucet.circle.com/`,
    );
  }
}
