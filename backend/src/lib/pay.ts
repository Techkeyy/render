import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createWalletClient, createPublicClient, http, parseUnits, defineChain, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.ts";

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [config.arcRpc] } },
});

/**
 * The agent's payment client. Wraps Circle's GatewayClient so the rest of the
 * code just says "pay to open this page" and gets back content + what it cost.
 */
export class AgentWallet {
  private gateway: GatewayClient;
  readonly address: string;

  constructor(privateKey: `0x${string}`) {
    this.gateway = new GatewayClient({ chain: config.chainKey, privateKey });
    // viem account address is derived inside GatewayClient; expose what we know.
    this.address = config.agentAddress;
  }

  /** Available USDC inside the Gateway wallet (what's spendable on x402 calls). */
  async available(): Promise<number> {
    const b = await this.gateway.getBalances();
    return Number(b.gateway.formattedAvailable);
  }

  async balances() {
    return this.gateway.getBalances();
  }

  /** Top up the Gateway wallet from the agent's on-chain USDC balance. */
  async deposit(amountUsdc: string): Promise<string> {
    const r = await this.gateway.deposit(amountUsdc);
    return r.depositTxHash;
  }

  /**
   * Pay the render service to open one page. Returns the rendered content and
   * the exact fare paid (a real settlement on Arc).
   */
  async payAndRender(url: string): Promise<{ paidUsdc: number; settlementId?: string; data: RenderPayload }> {
    const target = `${config.renderServiceUrl}/render?url=${encodeURIComponent(url)}`;
    const result = await this.gateway.pay(target, { method: "GET" });
    const data = result.data as RenderPayload;
    return {
      paidUsdc: Number(result.formattedAmount ?? config.renderPriceUsdc),
      settlementId: data?._payment?.settlementId ?? undefined,
      data,
    };
  }
  /**
   * Plain on-chain USDC transfer from the agent's wallet — used to refund the
   * unspent part of a user-funded task budget back to the user's wallet.
   */
  async transferUsdc(to: `0x${string}`, amountUsdc: number): Promise<string> {
    const account = privateKeyToAccount(config.agentPrivateKey);
    const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
    const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
    const hash = await walletClient.writeContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, parseUnits(amountUsdc.toFixed(6), 6)],
    });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    return hash;
  }

  /** Send the per-read tip to a publisher's own wallet (a real x402 settlement). */
  async tipPublisher(wallet: string, name: string): Promise<{ tipUsdc: number; settlementId?: string; publisher: string; publisherWallet: string }> {
    const target = `${config.renderServiceUrl}/tip?wallet=${encodeURIComponent(wallet)}&name=${encodeURIComponent(name)}`;
    const result = await this.gateway.pay(target, { method: "GET" });
    const data = result.data as { publisher: string; publisherWallet: string; tipUsdc: string; settlementId: string | null };
    return {
      tipUsdc: Number(data?.tipUsdc ?? config.tipPriceUsdc),
      settlementId: data?.settlementId ?? undefined,
      publisher: data?.publisher ?? name,
      publisherWallet: data?.publisherWallet ?? wallet,
    };
  }
}

export interface RenderPayload {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  renderedMs: number;
  _payment?: { payer: string | null; amountUsdc: string; network: string; settlementId: string | null };
}
