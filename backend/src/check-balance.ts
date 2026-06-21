import { createPublicClient, http, erc20Abi, formatUnits, formatEther } from "viem";
import { config } from "./config.ts";

const c = createPublicClient({ transport: http(config.arcRpc) });
const addr = config.agentAddress;

try {
  const native = await c.getBalance({ address: addr });
  const usdc = (await c.readContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  })) as bigint;
  console.log("agent           :", addr);
  console.log("native (gas,18dp):", formatEther(native));
  console.log("USDC ERC20 (6dp) :", formatUnits(usdc, 6));
} catch (e) {
  console.error("balance check failed:", (e as Error).message);
}
