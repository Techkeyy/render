import fs from "fs";
import path from "path";

/**
 * Tiny persistence layer for stats, errand history, and watches.
 *
 * Two backends, picked at boot:
 *   1. Upstash Redis (REST) — set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 *      Survives redeploys. Free tier is plenty.
 *   2. Local JSON file (data/store.json) — zero setup. Survives restarts, but on
 *      an ephemeral-disk host (Render.com free tier) is lost on redeploy.
 *
 * Single-process design: the whole store lives in memory and is flushed
 * (debounced) after every mutation. Callers mutate `store.data` directly and
 * call `store.touch()`.
 */

export interface TaskRecord {
  id: string;
  /** Username of the signed-in user who ran it, or null for anonymous. */
  user: string | null;
  goal: string;
  answer: string | null;
  confidence: string | null;
  spentUsdc: number;
  tippedUsdc: number;
  /** True when the user's own wallet funded the errand. */
  funded: boolean;
  receipt: { url: string; title: string; paidUsdc: number; settlementId?: string }[];
  createdAt: number;
}

export interface WatchRecord {
  id: string;
  /** Username of the signed-in owner, or null for anonymous (browser-local). */
  owner: string | null;
  input: { goal: string; seedUrls?: string[]; budgetUsdc: number; outputFields?: string[] };
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
}

export interface StoreData {
  stats: { errands: number; users: string[]; settledUsdc: number; tippedUsdc: number };
  tasks: TaskRecord[];
  watches: WatchRecord[];
}

const FILE = path.join(process.cwd(), "data", "store.json");
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/$/, "");
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const KEY = "render:store:v1";
const MAX_TASKS = 500;
const SAVE_DEBOUNCE_MS = 1000;

function emptyData(): StoreData {
  return { stats: { errands: 0, users: [], settledUsdc: 0, tippedUsdc: 0 }, tasks: [], watches: [] };
}

let data: StoreData = emptyData();
let saveTimer: NodeJS.Timeout | null = null;
let backend: "upstash" | "file" = UPSTASH_URL && UPSTASH_TOKEN ? "upstash" : "file";

/** Which persistence backend is active — surfaced in /health for quick diagnosis. */
export function storeBackend(): "upstash" | "file" {
  return backend;
}

function normalize(raw: unknown): StoreData {
  const d = (raw ?? {}) as Partial<StoreData>;
  const base = emptyData();
  return {
    stats: { ...base.stats, ...(d.stats ?? {}) },
    tasks: Array.isArray(d.tasks) ? d.tasks : [],
    watches: Array.isArray(d.watches) ? d.watches : [],
  };
}

export async function loadStore(): Promise<void> {
  try {
    if (backend === "upstash") {
      const res = await fetch(`${UPSTASH_URL}/get/${KEY}`, {
        headers: { authorization: `Bearer ${UPSTASH_TOKEN}` },
      });
      const json = (await res.json()) as { result: string | null };
      if (json.result) data = normalize(JSON.parse(json.result));
      console.log(`store: upstash backend, ${data.tasks.length} tasks, ${data.watches.length} watches`);
      return;
    }
    if (fs.existsSync(FILE)) {
      data = normalize(JSON.parse(fs.readFileSync(FILE, "utf8")));
    }
    console.log(`store: file backend (${FILE}), ${data.tasks.length} tasks, ${data.watches.length} watches`);
  } catch (e) {
    console.warn(`store: load failed, starting empty — ${(e as Error).message}`);
    data = emptyData();
  }
}

async function flush(): Promise<void> {
  // Cap history so the blob stays small enough for a single Redis value.
  if (data.tasks.length > MAX_TASKS) data.tasks.length = MAX_TASKS;
  const body = JSON.stringify(data);
  try {
    if (backend === "upstash") {
      await fetch(`${UPSTASH_URL}/set/${KEY}`, {
        method: "POST",
        headers: { authorization: `Bearer ${UPSTASH_TOKEN}` },
        body,
      });
      return;
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, body);
  } catch (e) {
    console.warn(`store: flush failed — ${(e as Error).message}`);
  }
}

export const store = {
  get data(): StoreData {
    return data;
  },
  /** Schedule a (debounced) persist after mutating `data`. */
  touch(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  },
};
