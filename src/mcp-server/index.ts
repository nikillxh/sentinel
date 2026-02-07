// ============================================================
// Sentinel – MCP Server Entry Point
// Registers all 4 tools with the MCP protocol and starts
// the server on stdio transport.
//
// Usage:
//   npx tsx src/mcp-server/index.ts
//
// Or connect from any MCP client (Claude Desktop, etc.)
// ============================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Logger } from "../shared/logger.js";
import { DEFAULT_POLICY, SESSION } from "../shared/constants.js";
import { PolicyEngine } from "../policy-engine/engine.js";
import { SessionManager } from "../session/manager.js";
import { SwapSimulator } from "./swap-simulator.js";
import { createUniswapV4Client } from "./uniswap-client.js";
import { createNitroliteChannel } from "../session/channel.js";
import { ToolHandlers, schemas } from "./tools.js";

const log = new Logger("mcp-server");

// ---- Initialize Components ----

const policyEngine = new PolicyEngine(DEFAULT_POLICY);
const nitroliteChannel = createNitroliteChannel();
const sessionManager = new SessionManager(nitroliteChannel);
const v4Client = createUniswapV4Client();
const swapSimulator = new SwapSimulator(v4Client);
const toolHandlers = new ToolHandlers(policyEngine, sessionManager, swapSimulator);

// ---- Create MCP Server ----

const server = new McpServer({
  name: "sentinel-wallet",
  version: "0.1.0",
});

// ---- Register Tools ----

server.tool(
  "get_session_balance",
  "Get the current off-chain balance for an asset in the active session. Returns balance amount, PnL, and total session value.",
  { asset: schemas.getSessionBalance.shape.asset },
  async (args) => {
    const result = await toolHandlers.getSessionBalance(args);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "simulate_swap",
  "Simulate a swap on Uniswap v4 without executing it. Returns estimated output, price impact, and whether the policy engine would approve it. Use this before propose_swap to preview the trade.",
  {
    tokenIn: schemas.simulateSwap.shape.tokenIn,
    tokenOut: schemas.simulateSwap.shape.tokenOut,
    amount: schemas.simulateSwap.shape.amount,
  },
  async (args) => {
    const result = await toolHandlers.simulateSwap(args);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "propose_swap",
  "Propose and execute a swap. The swap is simulated, checked against the policy engine (max 2% of balance, Uniswap v4 only, USDC/ETH only, max 0.5% slippage), and if approved, executed instantly off-chain. Returns the swap result and updated balances.",
  {
    tokenIn: schemas.proposeSwap.shape.tokenIn,
    tokenOut: schemas.proposeSwap.shape.tokenOut,
    amount: schemas.proposeSwap.shape.amount,
  },
  async (args) => {
    const result = await toolHandlers.proposeSwap(args);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "close_session_and_settle",
  "Close the current session and settle final balances on-chain. This finalizes all off-chain balance changes and submits them for on-chain settlement via ERC-4337. Returns the final balances, PnL, settlement tx hash, and full trade history.",
  {},
  async () => {
    const result = await toolHandlers.closeSessionAndSettle();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

// ---- Start Server ----

async function main() {
  log.separator("SENTINEL MCP SERVER");
  log.info("Starting MCP server on stdio transport...");
  log.info("Policy hash: " + policyEngine.getPolicyHash());

  // Open a session automatically for demo
  await sessionManager.open(SESSION.defaultDepositUsdc);
  log.info(`Session opened with ${SESSION.defaultDepositUsdc} USDC`);

  if (nitroliteChannel) {
    log.info("Nitrolite state channel: ENABLED");
  }
  if (v4Client) {
    log.info("Uniswap v4 on-chain quotes: ENABLED");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info("MCP server is running. Waiting for tool calls...");
}

main().catch((error) => {
  log.error("Fatal error starting MCP server", { error: String(error) });
  process.exit(1);
});
