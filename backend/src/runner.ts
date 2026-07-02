import { config } from "./config.ts";
import { AgentWallet } from "./lib/pay.ts";
import { discoverPublisher } from "./publishers.ts";
import * as brain from "./brain.ts";

export interface ReceiptRow {
  url: string;
  title: string;
  paidUsdc: number;
  settlementId?: string;
}

export type TaskEvent =
  | { type: "plan"; reasoning: string; extractionGoal: string; urls: { url: string; why: string }[] }
  | { type: "open"; url: string }
  | { type: "paid"; url: string; title: string; paidUsdc: number; settlementId?: string; spentUsdc: number }
  | { type: "finding"; url: string; finding: string; relevant: boolean; infoGain: number; confidence: number }
  | { type: "tipped"; url: string; publisher: string; publisherWallet: string; tipUsdc: number; settlementId?: string }
  | { type: "render_error"; url: string; error: string }
  | { type: "stop"; reason: string }
  // funded/refunded are emitted by the orchestrator when the signed-in user's
  // own wallet pays for the task (rather than the agent's house wallet).
  | { type: "funded"; amountUsdc: number; from: string; txId: string }
  | { type: "refunded"; amountUsdc: number; to: string; txHash: string | null }
  | { type: "answer"; answer: string; confidence: string; sources: { url: string; claim: string }[]; data: Record<string, unknown> | null; spentUsdc: number; returnedUsdc: number; receipt: ReceiptRow[]; verifyUrl: string }
  | { type: "error"; error: string };

export interface TaskInput {
  goal: string;
  seedUrls?: string[];
  budgetUsdc: number;
  outputFields?: string[];
}

/**
 * Run one errand end to end. The agent plans, then opens pages one at a time —
 * paying a real fare per page — deciding after each whether what it has is
 * enough, and always staying inside the budget it was given.
 *
 * `emit` streams progress (the live receipt). Funding the Gateway wallet is the
 * orchestrator's job (done once at boot), not per task.
 */
export async function runTask(input: TaskInput, emit: (e: TaskEvent) => void): Promise<void> {
  const price = config.renderPriceUsdc;
  const budget = Math.max(price, input.budgetUsdc);
  const wallet = new AgentWallet(config.agentPrivateKey);

  const receipt: ReceiptRow[] = [];
  const findings: string[] = [];
  let spent = 0;

  try {
    const plan = await brain.plan({
      goal: input.goal,
      seedUrls: input.seedUrls ?? [],
      budgetUsdc: budget,
      pricePerPage: price,
    });
    emit({ type: "plan", reasoning: plan.reasoning, extractionGoal: plan.extraction_goal, urls: plan.urls });

    const queue = plan.urls.map((u) => u.url);
    const visited = new Set<string>();

    while (queue.length > 0) {
      const url = queue[0]!;
      const pub = await discoverPublisher(url);
      const pageCost = price + (pub ? config.tipPriceUsdc : 0);
      if (spent + pageCost > budget) {
        emit({ type: "stop", reason: "budget reached — staying within the cap" });
        break;
      }
      queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      emit({ type: "open", url });

      let paid;
      try {
        paid = await wallet.payAndRender(url);
      } catch (e) {
        emit({ type: "render_error", url, error: (e as Error).message });
        continue;
      }

      spent += paid.paidUsdc;
      const title = paid.data?.title ?? "";
      receipt.push({ url, title, paidUsdc: paid.paidUsdc, settlementId: paid.settlementId });
      emit({ type: "paid", url, title, paidUsdc: paid.paidUsdc, settlementId: paid.settlementId, spentUsdc: spent });

      if (pub) {
        try {
          const tip = await wallet.tipPublisher(pub.wallet, pub.name);
          spent += tip.tipUsdc;
          receipt.push({ url, title: `tip → ${tip.publisher}`, paidUsdc: tip.tipUsdc, settlementId: tip.settlementId });
          emit({ type: "tipped", url, publisher: tip.publisher, publisherWallet: tip.publisherWallet, tipUsdc: tip.tipUsdc, settlementId: tip.settlementId });
        } catch (e) {
          console.warn(`publisher tip failed for ${pub.name}: ${(e as Error).message}`);
        }
      }

      const a = await brain.assess({
        goal: input.goal,
        extractionGoal: plan.extraction_goal,
        url,
        pageTitle: title,
        pageText: paid.data?.text ?? "",
        findingsSoFar: findings,
        remainingBudgetUsdc: budget - spent,
        pricePerPage: price,
      });
      if (a.relevant) findings.push(`[${url}] ${a.finding}`);
      emit({ type: "finding", url, finding: a.finding, relevant: a.relevant, infoGain: a.information_gain, confidence: a.confidence_so_far });

      if (a.enough_to_answer) {
        emit({ type: "stop", reason: "enough to answer — stopping" });
        break;
      }
      if (!a.worth_continuing) {
        emit({ type: "stop", reason: a.reason || "not worth opening another page" });
        break;
      }
    }

    const answer = await brain.synthesize({
      goal: input.goal,
      findings,
      outputFields: input.outputFields,
    });
    emit({
      type: "answer",
      answer: answer.answer,
      confidence: answer.confidence,
      sources: answer.sources,
      data: answer.data,
      spentUsdc: Number(spent.toFixed(6)),
      returnedUsdc: Number((budget - spent).toFixed(6)),
      receipt,
      verifyUrl: `${config.arcExplorer}/address/${config.agentAddress}`,
    });
  } catch (e) {
    emit({ type: "error", error: (e as Error).message });
  }
}
