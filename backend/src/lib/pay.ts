import { GatewayClient } from "@circle-fin/x402-batching/client";
import { config } from "../config.ts";

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
}

export interface RenderPayload {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  renderedMs: number;
  _payment?: { payer: string | null; amountUsdc: string; network: string; settlementId: string | null };
}
