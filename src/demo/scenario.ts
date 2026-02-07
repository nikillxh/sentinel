// ============================================================
// Sentinel – Demo Scenario
// Runs the full hackathon demo end-to-end:
//
//   1. Deposit 1000 USDC → open session
//   2. Simulate a 2% USDC→ETH swap
//   3. Execute the swap (policy-approved, off-chain)
//   4. Try an illegal 5% swap (policy rejects it)
//   5. Execute another valid swap
//   6. Close session & settle on-chain
//   7. Show final tx hash
//
// Run: npx tsx src/demo/scenario.ts
// ============================================================

import { Logger, LogLevel } from "../shared/logger.js";
import { DEFAULT_POLICY, SESSION } from "../shared/constants.js";
import { PolicyEngine } from "../policy-engine/engine.js";
import { SessionManager } from "../session/manager.js";
import { SwapSimulator } from "../mcp-server/swap-simulator.js";
import { ToolHandlers } from "../mcp-server/tools.js";

Logger.setLevel(LogLevel.DEBUG);
const log = new Logger("demo");

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  log.separator("🛡️  SENTINEL – Policy-Governed MCP Wallet Demo");
  log.info("ETHGlobal HackMoney 2026");
  log.info("");

  // ---- Initialize ----
  const policyEngine = new PolicyEngine(DEFAULT_POLICY);
  const sessionManager = new SessionManager();
  const swapSimulator = new SwapSimulator();
  const tools = new ToolHandlers(policyEngine, sessionManager, swapSimulator);

  // ---- Step 1: Open Session ----
  log.separator("STEP 1: Open Session with 1000 USDC Deposit");
  await sessionManager.open(SESSION.defaultDepositUsdc);

  const bal = await tools.getSessionBalance({ asset: "USDC" });
  log.info("Initial balance:", bal.data);
  await sleep(300);

  // ---- Step 2: Simulate Swap ----
  log.separator("STEP 2: Simulate 2% USDC → ETH Swap");
  const sim = await tools.simulateSwap({
    tokenIn: "USDC",
    tokenOut: "ETH",
    amount: 20,
  });
  const simData = sim.data as any;
  log.info("Simulation result:", {
    estimatedAmountOut: simData.simulation.estimatedAmountOut,
    priceImpactBps: simData.simulation.priceImpactBps,
    route: simData.simulation.route,
  });
  log.info(`Would be approved: ${simData.wouldBeApproved}`);
  await sleep(300);

  // ---- Step 3: Execute Approved Swap ----
  log.separator("STEP 3: Execute 2% USDC → ETH Swap (Policy Check → Off-Chain)");
  const swap1 = await tools.proposeSwap({
    tokenIn: "USDC",
    tokenOut: "ETH",
    amount: 20,
  });
  if (swap1.success) {
    log.info("✅ Swap 1 executed successfully", (swap1.data as any).swapResult);
    log.info("Updated balances:", (swap1.data as any).updatedBalances);
  }
  await sleep(300);

  // ---- Step 4: Try Illegal Swap (should be REJECTED) ----
  log.separator("STEP 4: Attempt Illegal 5% Swap (Should Be Rejected)");
  const illegalSwap = await tools.proposeSwap({
    tokenIn: "USDC",
    tokenOut: "ETH",
    amount: 50, // 5% of ~980 balance — exceeds 2% limit
  });
  if (!illegalSwap.success) {
    log.info("🚫 Swap correctly rejected:", illegalSwap.error);
  }
  await sleep(300);

  // ---- Step 5: Execute Another Valid Swap ----
  log.separator("STEP 5: Execute Another Valid 2% Swap");
  // 2% of ~980 USDC remaining = ~19.6
  const swap2 = await tools.proposeSwap({
    tokenIn: "USDC",
    tokenOut: "ETH",
    amount: 19.6,
  });
  if (swap2.success) {
    log.info("✅ Swap 2 executed successfully", (swap2.data as any).swapResult);
    log.info("Updated balances:", (swap2.data as any).updatedBalances);
  }
  await sleep(300);

  // ---- Step 6: Check All Balances ----
  log.separator("STEP 6: Current Session State");
  const usdcBal = await tools.getSessionBalance({ asset: "USDC" });
  const ethBal = await tools.getSessionBalance({ asset: "ETH" });
  log.info("USDC:", (usdcBal.data as any).balance);
  log.info("ETH:", (ethBal.data as any).balance);
  await sleep(300);

  // ---- Step 7: Close & Settle ----
  log.separator("STEP 7: Close Session & Settle On-Chain");
  const settlement = await tools.closeSessionAndSettle();
  if (settlement.success) {
    const data = settlement.data as any;
    log.info("");
    log.info("══════════════════════════════════════");
    log.info("  SETTLEMENT COMPLETE");
    log.info("══════════════════════════════════════");
    log.info(`  Session:    ${data.sessionId}`);
    log.info(`  Status:     ${data.status}`);
    log.info(`  USDC:       ${data.finalBalances.USDC}`);
    log.info(`  ETH:        ${data.finalBalances.ETH}`);
    log.info(`  Total Swaps: ${data.totalSwaps}`);
    log.info(`  Value (USD): $${data.totalValueUsd.toFixed(2)}`);
    log.info(`  Tx Hash:    ${data.settlementTxHash}`);
    log.info(`  Policy Hash: ${policyEngine.getPolicyHash()}`);
    log.info("══════════════════════════════════════");
    log.info("");
  }

  log.separator("🏁 Demo Complete");
}

run().catch((err) => {
  log.error("Demo failed:", err);
  process.exit(1);
});
