import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.ts";

/**
 * The agent's brain. Three jobs:
 *   1. plan()      — decide which pages are worth opening, given a goal + budget
 *   2. assess()    — after each page: what did it tell us, and is it worth opening another?
 *   3. synthesize()— turn the findings into a final answer
 *
 * The economic decision lives in assess(): "given what I now know and how much
 * budget is left, is opening the next page worth the fare?" That's the agent
 * deciding how to spend, not just automating a fixed list.
 *
 * Uses an OpenAI-compatible endpoint (DeepSeek by default) in JSON mode, with
 * zod validating the shape of every response.
 */

const client = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl, timeout: 45_000 });

const MAX_PAGE_TEXT = 8000;

// --- schemas (zod validates the model's JSON; z.infer gives the TS types) ---
const PlanSchema = z.object({
  reasoning: z.string(),
  extraction_goal: z.string(),
  urls: z.array(z.object({ url: z.string(), why: z.string() })),
});
export type Plan = z.infer<typeof PlanSchema>;

const AssessSchema = z.object({
  finding: z.string(),
  relevant: z.boolean(),
  information_gain: z.number().min(0).max(1),
  confidence_so_far: z.number().min(0).max(1),
  expected_value_of_next: z.number().min(0).max(1),
  enough_to_answer: z.boolean(),
  worth_continuing: z.boolean(),
  reason: z.string(),
});
export type Assessment = z.infer<typeof AssessSchema>;

const AnswerSchema = z.object({
  answer: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type Answer = z.infer<typeof AnswerSchema>;

async function jsonCall<T>(opts: {
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  const res = await client.chat.completions.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  const content = res.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`brain: model did not return JSON: ${content.slice(0, 200)}`);
  }
  return opts.schema.parse(parsed);
}

export async function plan(opts: {
  goal: string;
  seedUrls: string[];
  budgetUsdc: number;
  pricePerPage: number;
}): Promise<Plan> {
  const maxPages = Math.max(1, Math.min(config.maxPagesPerTask, Math.floor(opts.budgetUsdc / opts.pricePerPage)));
  const seeds = opts.seedUrls.length
    ? `The user supplied these pages to work from:\n${opts.seedUrls.map((u) => `- ${u}`).join("\n")}`
    : `The user supplied no pages. Propose full, real, openable URLs likely to answer the goal.`;

  const p = await jsonCall({
    model: config.modelPlan,
    maxTokens: 1500,
    schema: PlanSchema,
    system:
      "You plan web errands for an agent that pays a small fare to open each page. " +
      "Opening a page costs real money, so only include pages genuinely worth opening, " +
      "ranked best-first, and never more than the budget allows.\n" +
      'Respond ONLY with a JSON object of exactly this shape: ' +
      '{"reasoning": string, "extraction_goal": string, "urls": [{"url": string, "why": string}]}. ' +
      "extraction_goal says what to pull from each page to answer the goal.",
    user:
      `Goal: ${opts.goal}\n\n${seeds}\n\n` +
      `Budget: $${opts.budgetUsdc.toFixed(4)} at $${opts.pricePerPage} per page ` +
      `(so at most ${maxPages} pages). Return at most ${maxPages} URLs in the "urls" array.`,
  });
  return { ...p, urls: p.urls.slice(0, maxPages) };
}

export async function assess(opts: {
  goal: string;
  extractionGoal: string;
  url: string;
  pageTitle: string;
  pageText: string;
  findingsSoFar: string[];
  remainingBudgetUsdc: number;
  pricePerPage: number;
}): Promise<Assessment> {
  const canAffordMore = opts.remainingBudgetUsdc >= opts.pricePerPage;
  return jsonCall({
    model: config.modelLoop,
    maxTokens: 900,
    schema: AssessSchema,
    system:
      "You read one web page for an errand agent and extract only what matters for the goal. " +
      "Then you make a spending decision. Each extra page costs a fare (real money), so you must " +
      "estimate whether the INFORMATION GAIN from the next page justifies the cost.\n\n" +
      "Respond ONLY with a JSON object:\n" +
      "{\n" +
      '  "finding": string,              // what this page contributed (or "nothing relevant")\n' +
      '  "relevant": boolean,            // did this page help?\n' +
      '  "information_gain": number 0-1, // how much new info THIS page added (0=nothing, 1=complete answer)\n' +
      '  "confidence_so_far": number 0-1,// how confident you are the goal can be answered with what you have\n' +
      '  "expected_value_of_next": number 0-1, // estimated info gain from opening one more page\n' +
      '  "enough_to_answer": boolean,    // can you answer the goal NOW without more pages?\n' +
      '  "worth_continuing": boolean,    // is expected_value_of_next high enough to justify the fare?\n' +
      '  "reason": string                // one sentence: the cost-benefit logic behind your decision\n' +
      "}\n\n" +
      "The worth_continuing decision should weigh expected_value_of_next against the fare cost " +
      "relative to remaining budget. If confidence_so_far > 0.8, lean toward stopping.",
    user:
      `Goal: ${opts.goal}\n` +
      `What to extract: ${opts.extractionGoal}\n` +
      `Budget left: $${opts.remainingBudgetUsdc.toFixed(4)} ` +
      `(${canAffordMore ? "enough for more pages" : "cannot afford another page"}).\n\n` +
      `Findings so far:\n${opts.findingsSoFar.length ? opts.findingsSoFar.map((f) => `- ${f}`).join("\n") : "(none yet)"}\n\n` +
      `Page just opened: ${opts.url}\nTitle: ${opts.pageTitle}\n\n` +
      `Page text (truncated to ${MAX_PAGE_TEXT} chars):\n${opts.pageText.slice(0, MAX_PAGE_TEXT)}`,
  });
}

export async function synthesize(opts: { goal: string; findings: string[] }): Promise<Answer> {
  return jsonCall({
    model: config.modelPlan,
    maxTokens: 1200,
    schema: AnswerSchema,
    system:
      "You answer the user's goal using only the findings the agent gathered from the pages it opened. " +
      "Be direct and concrete. If the findings are thin, say so and lower the confidence.\n" +
      'Respond ONLY with a JSON object of exactly this shape: ' +
      '{"answer": string, "confidence": "high" | "medium" | "low"}.',
    user:
      `Goal: ${opts.goal}\n\nFindings gathered:\n` +
      (opts.findings.length ? opts.findings.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(no useful findings)"),
  });
}
