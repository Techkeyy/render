import Anthropic from "@anthropic-ai/sdk";
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
 * We get structured output by forcing a single tool call and reading its input,
 * then validating it with zod. (Works on the GA Messages API — no preview deps.)
 */

const client = new Anthropic({ apiKey: config.anthropicApiKey || undefined });

// --- schemas (zod for runtime validation + TS types) ---
const PlanSchema = z.object({
  reasoning: z.string(),
  extraction_goal: z.string(),
  urls: z.array(z.object({ url: z.string(), why: z.string() })),
});
export type Plan = z.infer<typeof PlanSchema>;

const AssessSchema = z.object({
  finding: z.string(),
  relevant: z.boolean(),
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

// --- tool definitions (JSON schema the model fills in) ---
const planTool: Anthropic.Tool = {
  name: "submit_plan",
  description: "Submit the ranked list of pages worth opening to achieve the goal.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: { type: "string", description: "brief: why these pages, in this order" },
      extraction_goal: { type: "string", description: "what to pull from each page to answer the goal" },
      urls: {
        type: "array",
        description: "pages ranked best-first, capped to the budget",
        items: {
          type: "object",
          properties: {
            url: { type: "string", description: "a full http(s) URL worth opening" },
            why: { type: "string", description: "what you expect this page to contribute" },
          },
          required: ["url", "why"],
        },
      },
    },
    required: ["reasoning", "extraction_goal", "urls"],
  },
};

const assessTool: Anthropic.Tool = {
  name: "submit_assessment",
  description: "Report what the page contributed and decide whether to keep spending.",
  input_schema: {
    type: "object",
    properties: {
      finding: { type: "string", description: "what this page contributed, or 'nothing relevant'" },
      relevant: { type: "boolean" },
      enough_to_answer: { type: "boolean", description: "true if we can now answer the goal well" },
      worth_continuing: { type: "boolean", description: "if budget remains, is opening another page worth the fare?" },
      reason: { type: "string", description: "one sentence on the spend decision" },
    },
    required: ["finding", "relevant", "enough_to_answer", "worth_continuing", "reason"],
  },
};

const answerTool: Anthropic.Tool = {
  name: "submit_answer",
  description: "Submit the final answer to the user's goal.",
  input_schema: {
    type: "object",
    properties: {
      answer: { type: "string", description: "the direct answer, citing what was found" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["answer", "confidence"],
  },
};

async function callTool<T>(opts: {
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  tool: Anthropic.Tool;
  schema: z.ZodType<T>;
}): Promise<T> {
  const msg = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    tools: [opts.tool],
    tool_choice: { type: "tool", name: opts.tool.name },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.tool.name);
  if (!block) throw new Error(`brain: model did not call ${opts.tool.name}`);
  return opts.schema.parse(block.input);
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

  const p = await callTool({
    model: config.modelPlan,
    maxTokens: 1500,
    tool: planTool,
    schema: PlanSchema,
    system:
      "You plan web errands for an agent that pays a small fare to open each page. " +
      "Opening a page costs real money, so only include pages genuinely worth opening, " +
      "ranked best-first, and never more than the budget allows.",
    user:
      `Goal: ${opts.goal}\n\n${seeds}\n\n` +
      `Budget: $${opts.budgetUsdc.toFixed(4)} at $${opts.pricePerPage} per page ` +
      `(so at most ${maxPages} pages). Return at most ${maxPages} URLs.`,
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
  return callTool({
    model: config.modelLoop,
    maxTokens: 900,
    tool: assessTool,
    schema: AssessSchema,
    system:
      "You read one web page for an errand agent and extract only what matters for the goal. " +
      "Then you make a spending decision: each extra page costs a fare, so say whether opening " +
      "another is worth it given what is already known and the budget left.",
    user:
      `Goal: ${opts.goal}\n` +
      `What to extract: ${opts.extractionGoal}\n` +
      `Budget left: $${opts.remainingBudgetUsdc.toFixed(4)} ` +
      `(${canAffordMore ? "enough for more pages" : "cannot afford another page"}).\n\n` +
      `Findings so far:\n${opts.findingsSoFar.length ? opts.findingsSoFar.map((f) => `- ${f}`).join("\n") : "(none yet)"}\n\n` +
      `Page just opened: ${opts.url}\nTitle: ${opts.pageTitle}\n\n` +
      `Page text:\n${opts.pageText}`,
  });
}

export async function synthesize(opts: { goal: string; findings: string[] }): Promise<Answer> {
  return callTool({
    model: config.modelPlan,
    maxTokens: 1200,
    tool: answerTool,
    schema: AnswerSchema,
    system:
      "You answer the user's goal using only the findings the agent gathered from the pages it opened. " +
      "Be direct and concrete. If the findings are thin, say so and lower the confidence.",
    user:
      `Goal: ${opts.goal}\n\nFindings gathered:\n` +
      (opts.findings.length ? opts.findings.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(no useful findings)"),
  });
}
