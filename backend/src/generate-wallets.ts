import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(".env.local");

function gen(label: string) {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  console.log(`\n${label}`);
  console.log(`  Address:     ${address}`);
  console.log(`  Private key: ${privateKey}`);
  return { address, privateKey };
}

function upsert(content: string, key: string, value: string) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}`;
}

// SELLER — the render service's wallet; this is where per-page fares land.
const seller = gen("Seller  (render service — receives the fares)");
// AGENT — the buyer's wallet; fund THIS one via the faucet. It pays for renders.
const agent = gen("Agent   (the buyer — fund this one via the faucet)");

let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
const values: Record<string, string> = {
  SELLER_ADDRESS: seller.address,
  SELLER_PRIVATE_KEY: seller.privateKey,
  AGENT_ADDRESS: agent.address,
  AGENT_PRIVATE_KEY: agent.privateKey,
};
for (const [k, v] of Object.entries(values)) content = upsert(content, k, v);
if (!/^ANTHROPIC_API_KEY=/m.test(content)) content = upsert(content, "ANTHROPIC_API_KEY", "");
fs.writeFileSync(envPath, content.trimEnd() + "\n");

console.log(`\nWritten to ${envPath}`);
console.log(`
Next steps:
  1. Fund the AGENT wallet with Arc Testnet USDC (this pays for renders + gas):
       https://faucet.circle.com/
       Paste: ${agent.address}
  2. Add your ANTHROPIC_API_KEY to .env.local (the agent's brain).
  3. Start the render service:   npm run render-service
  4. Start the orchestrator:     npm run orchestrator
`);
