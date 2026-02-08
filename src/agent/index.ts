// ============================================================
// Sentinel – AI Agent
// The "brain" that uses LLM reasoning to autonomously execute
// DeFi operations through the MCP tool layer. Receives natural
// language instructions, reasons about the best strategy, and
// calls policy-checked tools to execute swaps safely.
//
// Supports OpenAI (GPT-4o) and Anthropic (Claude) as LLM backends.
// Falls back to a rule-based heuristic if no API key is configured.
//
// This is what makes Sentinel an *AI-driven* wallet:
//   User says "swap some USDC to ETH" →
//   Agent reasons about amount, checks balance, simulates →
//   Policy engine approves/rejects → executes off-chain
// ============================================================

import { Logger } from "../shared/logger.js";
import type {
  Asset,
  SwapSimulation,
  ToolResponse,
  PolicyDecision,
} from "../shared/types.js";

// ---- Types ----

export interface AgentConfig {
  /** LLM provider: "openai" | "anthropic" | "heuristic" */
  provider: "openai" | "anthropic" | "heuristic";
  /** API key for the LLM provider */
  apiKey?: string;
  /** Model name (e.g. "gpt-4o", "claude-sonnet-4-20250514") */
  model?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Max tokens for LLM response */
  maxTokens?: number;
}

export interface AgentMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCall?: ToolCallInfo;
  toolResult?: ToolResultInfo;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultInfo {
  toolCallId: string;
  result: unknown;
}

/** What the agent decides to do */
export interface AgentAction {
  type: "simulate" | "swap" | "balance" | "settle" | "respond";
  /** Tool arguments (for simulate/swap/balance) */
  params?: Record<string, unknown>;
  /** Text response to user */
  message: string;
  /** Chain of thought reasoning */
  reasoning?: string;
}

/** Tool executor interface — injected from API server */
export interface ToolExecutor {
  getBalance(asset: Asset): Promise<ToolResponse>;
  simulateSwap(tokenIn: Asset, tokenOut: Asset, amount: number): Promise<SwapSimulation>;
  proposeSwap(tokenIn: Asset, tokenOut: Asset, amount: number): Promise<ToolResponse>;
  closeSession(): Promise<ToolResponse>;
  getSessionSummary(): { balances: Record<string, number>; totalSwaps: number; totalValueUsd: number; status: string };
}

// ---- System Prompt ----

const SENTINEL_SYSTEM_PROMPT = `You are Sentinel, an AI DeFi trading agent. You manage a policy-governed wallet that can execute swaps on Uniswap v4 via off-chain state channels.

## Your Capabilities
You have access to these tools:
1. **get_balance(asset)** - Check USDC or ETH balance
2. **simulate_swap(tokenIn, tokenOut, amount)** - Preview a swap without executing
3. **propose_swap(tokenIn, tokenOut, amount)** - Execute a policy-checked swap
4. **close_session()** - Close the session and settle on-chain

## Policy Rules (enforced automatically)
- Max trade size: 2% of session balance per swap
- Allowed DEXes: Uniswap v4 only
- Allowed assets: USDC and ETH only
- Max slippage: 0.5% (50 bps)

## Your Behavior
- Always check balances before proposing swaps
- Always simulate before executing to show the user what to expect
- Explain your reasoning clearly
- If a swap would be rejected by policy, explain why and suggest alternatives
- When the user says "swap X USDC to ETH" or similar, calculate the right amount
- Be conservative — you're managing real funds
- Round amounts sensibly (no more than 2 decimal places for USDC, 6 for ETH)

## Response Format
Respond conversationally but include relevant numbers. When you execute a tool, explain what you're doing and why.`;

// ---- Agent Class ----

export class SentinelAgent {
  private config: AgentConfig;
  private log = new Logger("agent");
  private conversationHistory: AgentMessage[] = [];
  private tools: ToolExecutor | null = null;

  constructor(config: AgentConfig) {
    this.config = {
      maxTokens: 1024,
      ...config,
    };

    this.log.info(`AI Agent initialized (provider: ${config.provider})`);

    if (config.provider !== "heuristic" && !config.apiKey) {
      this.log.warn("No API key provided, falling back to heuristic mode");
      this.config.provider = "heuristic";
    }
  }

  /** Inject tool executor from API server */
  setToolExecutor(executor: ToolExecutor): void {
    this.tools = executor;
  }

  /** Process a user message and return the agent's response + any actions taken */
  async chat(userMessage: string): Promise<AgentMessage[]> {
    this.log.info(`User: ${userMessage}`);

    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    let responses: AgentMessage[];

    switch (this.config.provider) {
      case "openai":
        responses = await this.chatOpenAI(userMessage);
        break;
      case "anthropic":
        responses = await this.chatAnthropic(userMessage);
        break;
      case "heuristic":
      default:
        responses = await this.chatHeuristic(userMessage);
        break;
    }

    // Add responses to conversation history
    for (const msg of responses) {
      this.conversationHistory.push(msg);
    }

    return responses;
  }

  /** Reset conversation history */
  resetConversation(): void {
    this.conversationHistory = [];
    this.log.info("Conversation history cleared");
  }

  /** Get full conversation history */
  getHistory(): AgentMessage[] {
    return [...this.conversationHistory];
  }

  // ---- OpenAI Implementation ----

  private async chatOpenAI(userMessage: string): Promise<AgentMessage[]> {
    const messages = [
      { role: "system" as const, content: this.config.systemPrompt ?? SENTINEL_SYSTEM_PROMPT },
      ...this.conversationHistory.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    const toolDefs = this.getOpenAIToolDefs();

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model ?? "gpt-4o",
          messages,
          tools: toolDefs,
          tool_choice: "auto",
          max_tokens: this.config.maxTokens,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as OpenAIResponse;
      return await this.processOpenAIResponse(data);
    } catch (err) {
      this.log.error("OpenAI API call failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.chatHeuristic(userMessage);
    }
  }

  private async processOpenAIResponse(data: OpenAIResponse): Promise<AgentMessage[]> {
    const choice = data.choices?.[0];
    if (!choice) {
      return [{ role: "assistant", content: "I couldn't generate a response. Please try again." }];
    }

    const results: AgentMessage[] = [];

    // Handle tool calls
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      for (const tc of choice.message.tool_calls) {
        const toolName = tc.function.name;
        const toolArgs = JSON.parse(tc.function.arguments);

        this.log.info(`AI calling tool: ${toolName}`, toolArgs);

        const toolResult = await this.executeTool(toolName, toolArgs);

        results.push({
          role: "tool",
          content: `Called ${toolName}: ${JSON.stringify(toolResult, null, 2)}`,
          toolCall: { id: tc.id, name: toolName, arguments: toolArgs },
          toolResult: { toolCallId: tc.id, result: toolResult },
        });
      }
    }

    // Add the text response
    if (choice.message.content) {
      results.push({
        role: "assistant",
        content: choice.message.content,
      });
    }

    // If we had tool calls but no final text, make a follow-up call
    if (results.length > 0 && !choice.message.content) {
      results.push({
        role: "assistant",
        content: this.summarizeToolResults(results),
      });
    }

    return results;
  }

  private getOpenAIToolDefs(): OpenAIToolDef[] {
    return [
      {
        type: "function",
        function: {
          name: "get_balance",
          description: "Get the current balance for USDC or ETH in the active session",
          parameters: {
            type: "object",
            properties: {
              asset: { type: "string", enum: ["USDC", "ETH"], description: "The asset to check" },
            },
            required: ["asset"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "simulate_swap",
          description: "Simulate a swap to preview the expected output, price impact, and policy approval without executing",
          parameters: {
            type: "object",
            properties: {
              tokenIn: { type: "string", enum: ["USDC", "ETH"] },
              tokenOut: { type: "string", enum: ["USDC", "ETH"] },
              amount: { type: "number", description: "Amount of tokenIn to swap" },
            },
            required: ["tokenIn", "tokenOut", "amount"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "propose_swap",
          description: "Execute a policy-checked swap. The swap passes through simulation, policy engine (2% max, 0.5% slippage), and if approved, executes off-chain instantly.",
          parameters: {
            type: "object",
            properties: {
              tokenIn: { type: "string", enum: ["USDC", "ETH"] },
              tokenOut: { type: "string", enum: ["USDC", "ETH"] },
              amount: { type: "number", description: "Amount of tokenIn to swap" },
            },
            required: ["tokenIn", "tokenOut", "amount"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "close_session",
          description: "Close the current session and settle all balances on-chain",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
  }

  // ---- Anthropic Implementation ----

  private async chatAnthropic(userMessage: string): Promise<AgentMessage[]> {
    const messages = this.conversationHistory
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const tools = this.getAnthropicToolDefs();

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.config.model ?? "claude-sonnet-4-20250514",
          max_tokens: this.config.maxTokens,
          system: this.config.systemPrompt ?? SENTINEL_SYSTEM_PROMPT,
          messages,
          tools,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as AnthropicResponse;
      return await this.processAnthropicResponse(data);
    } catch (err) {
      this.log.error("Anthropic API call failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.chatHeuristic(userMessage);
    }
  }

  private async processAnthropicResponse(data: AnthropicResponse): Promise<AgentMessage[]> {
    const results: AgentMessage[] = [];

    for (const block of data.content) {
      if (block.type === "text") {
        results.push({ role: "assistant", content: block.text });
      } else if (block.type === "tool_use") {
        const toolName = block.name;
        const toolArgs = block.input as Record<string, unknown>;

        this.log.info(`AI calling tool: ${toolName}`, toolArgs);
        const toolResult = await this.executeTool(toolName, toolArgs);

        results.push({
          role: "tool",
          content: `Called ${toolName}: ${JSON.stringify(toolResult, null, 2)}`,
          toolCall: { id: block.id, name: toolName, arguments: toolArgs },
          toolResult: { toolCallId: block.id, result: toolResult },
        });
      }
    }

    // If only tool results, add a summary
    if (results.length > 0 && !results.some((r) => r.role === "assistant")) {
      results.push({
        role: "assistant",
        content: this.summarizeToolResults(results),
      });
    }

    return results;
  }

  private getAnthropicToolDefs(): AnthropicToolDef[] {
    return [
      {
        name: "get_balance",
        description: "Get the current balance for USDC or ETH in the active session",
        input_schema: {
          type: "object",
          properties: {
            asset: { type: "string", enum: ["USDC", "ETH"], description: "The asset to check" },
          },
          required: ["asset"],
        },
      },
      {
        name: "simulate_swap",
        description: "Simulate a swap to preview expected output and policy approval",
        input_schema: {
          type: "object",
          properties: {
            tokenIn: { type: "string", enum: ["USDC", "ETH"] },
            tokenOut: { type: "string", enum: ["USDC", "ETH"] },
            amount: { type: "number", description: "Amount of tokenIn to swap" },
          },
          required: ["tokenIn", "tokenOut", "amount"],
        },
      },
      {
        name: "propose_swap",
        description: "Execute a policy-checked swap off-chain",
        input_schema: {
          type: "object",
          properties: {
            tokenIn: { type: "string", enum: ["USDC", "ETH"] },
            tokenOut: { type: "string", enum: ["USDC", "ETH"] },
            amount: { type: "number", description: "Amount of tokenIn to swap" },
          },
          required: ["tokenIn", "tokenOut", "amount"],
        },
      },
      {
        name: "close_session",
        description: "Close the session and settle on-chain",
        input_schema: {
          type: "object",
          properties: {},
        },
      },
    ];
  }

  // ---- Heuristic (No-API-Key) Implementation ----

  private async chatHeuristic(userMessage: string): Promise<AgentMessage[]> {
    const msg = userMessage.toLowerCase().trim();
    const results: AgentMessage[] = [];

    if (!this.tools) {
      return [{
        role: "assistant",
        content: "⚠️ No active session. Please open a session first from the dashboard, then I can help you trade.",
      }];
    }

    // Parse intent from natural language
    const intent = this.parseIntent(msg);

    switch (intent.type) {
      case "balance": {
        const asset = intent.asset ?? "USDC";
        const balResult = await this.executeTool("get_balance", { asset });
        results.push({
          role: "tool",
          content: JSON.stringify(balResult),
          toolCall: { id: `h-${Date.now()}`, name: "get_balance", arguments: { asset } },
        });

        const summary = this.tools.getSessionSummary();
        results.push({
          role: "assistant",
          content: `📊 **Current Balances:**\n- USDC: $${summary.balances.USDC?.toFixed(2) ?? "0.00"}\n- ETH: ${summary.balances.ETH?.toFixed(6) ?? "0.000000"} ETH\n- Total Value: $${summary.totalValueUsd.toFixed(2)}\n- Swaps this session: ${summary.totalSwaps}`,
        });
        break;
      }

      case "simulate": {
        const { tokenIn, tokenOut, amount } = intent;
        if (!tokenIn || !tokenOut || !amount) {
          results.push({
            role: "assistant",
            content: "I need to know what to simulate. Try: \"simulate swapping 20 USDC to ETH\"",
          });
          break;
        }

        const sim = await this.executeTool("simulate_swap", { tokenIn, tokenOut, amount });
        const simData = sim as SwapSimulation;

        results.push({
          role: "tool",
          content: JSON.stringify(sim),
          toolCall: { id: `h-${Date.now()}`, name: "simulate_swap", arguments: { tokenIn, tokenOut, amount } },
        });

        results.push({
          role: "assistant",
          content: `🔍 **Swap Simulation: ${amount} ${tokenIn} → ${tokenOut}**\n\n` +
            `- Expected output: ${simData.estimatedAmountOut?.toFixed(6) ?? "?"} ${tokenOut}\n` +
            `- Price impact: ${simData.priceImpactBps ?? "?"} bps\n` +
            `- Route: ${simData.route ?? "Uniswap v4"}\n` +
            `- Policy: ${simData.policyApproved ? "✅ Would be approved" : "❌ Would be rejected"}\n\n` +
            `Would you like me to execute this swap?`,
        });
        break;
      }

      case "swap": {
        const { tokenIn, tokenOut, amount } = intent;
        if (!tokenIn || !tokenOut || !amount) {
          results.push({
            role: "assistant",
            content: "I need to know what to swap. Try: \"swap 20 USDC to ETH\"",
          });
          break;
        }

        // First simulate
        results.push({
          role: "assistant",
          content: `🔄 Let me simulate ${amount} ${tokenIn} → ${tokenOut} first...`,
        });

        const sim = await this.executeTool("simulate_swap", { tokenIn, tokenOut, amount }) as SwapSimulation;

        if (sim && !sim.policyApproved) {
          results.push({
            role: "assistant",
            content: `❌ **Policy would reject this swap.**\n\nThe policy engine enforces a 2% max trade size per swap. ` +
              `Your ${amount} ${tokenIn} might exceed that limit.\n\n` +
              `💡 Try a smaller amount. I recommend: \`swap ${Math.floor(amount * 0.4)} ${tokenIn} to ${tokenOut}\``,
          });
          break;
        }

        // Execute
        const result = await this.executeTool("propose_swap", { tokenIn, tokenOut, amount });
        const swapData = result as ToolResponse;

        results.push({
          role: "tool",
          content: JSON.stringify(result),
          toolCall: { id: `h-${Date.now()}`, name: "propose_swap", arguments: { tokenIn, tokenOut, amount } },
        });

        if (swapData.success) {
          const data = swapData.data as Record<string, unknown>;
          const swapResult = data?.swapResult as Record<string, unknown> | undefined;
          results.push({
            role: "assistant",
            content: `✅ **Swap Executed Successfully!**\n\n` +
              `- Swapped: ${amount} ${tokenIn}\n` +
              `- Received: ${(swapResult?.amountOut as number)?.toFixed(6) ?? "?"} ${tokenOut}\n` +
              `- Execution: Off-chain (instant, gasless)\n` +
              `- Proposal ID: ${swapResult?.proposalId ?? "?"}\n\n` +
              `The swap was approved by the policy engine and executed via the Nitrolite state channel.`,
          });
        } else {
          results.push({
            role: "assistant",
            content: `❌ **Swap Rejected:** ${swapData.error}\n\nThe policy engine blocked this trade. Try a smaller amount or check your balance.`,
          });
        }
        break;
      }

      case "settle": {
        results.push({
          role: "assistant",
          content: "🔒 Closing session and settling on-chain...",
        });

        const settleResult = await this.executeTool("close_session", {});

        results.push({
          role: "tool",
          content: JSON.stringify(settleResult),
          toolCall: { id: `h-${Date.now()}`, name: "close_session", arguments: {} },
        });

        results.push({
          role: "assistant",
          content: "✅ **Session closed and settled on-chain.** All balances have been finalized.",
        });
        break;
      }

      case "help": {
        results.push({
          role: "assistant",
          content: `🛡️ **I'm Sentinel, your AI DeFi trading agent.**\n\n` +
            `Here's what I can do:\n\n` +
            `- **"check balance"** — View your USDC and ETH balances\n` +
            `- **"simulate swap 20 USDC to ETH"** — Preview a trade\n` +
            `- **"swap 20 USDC to ETH"** — Execute a policy-checked swap\n` +
            `- **"close session"** — Settle on-chain and close\n\n` +
            `All trades pass through a policy engine that enforces:\n` +
            `- Max 2% of balance per trade\n` +
            `- Only USDC ↔ ETH on Uniswap v4\n` +
            `- Max 0.5% slippage\n\n` +
            `Swaps execute instantly off-chain via Nitrolite state channels and settle on-chain when you close.`,
        });
        break;
      }

      default: {
        results.push({
          role: "assistant",
          content: `I'm not sure what you'd like to do. Try:\n` +
            `- "check my balance"\n` +
            `- "swap 20 USDC to ETH"\n` +
            `- "simulate 15 USDC to ETH"\n` +
            `- "close session"\n` +
            `- "help"`,
        });
      }
    }

    return results;
  }

  // ---- Intent Parsing ----

  private parseIntent(msg: string): {
    type: "balance" | "simulate" | "swap" | "settle" | "help" | "unknown";
    tokenIn?: Asset;
    tokenOut?: Asset;
    amount?: number;
    asset?: Asset;
  } {
    // Help
    if (msg.includes("help") || msg.includes("what can you") || msg.includes("how do")) {
      return { type: "help" };
    }

    // Settlement
    if (msg.includes("close") || msg.includes("settle") || msg.includes("finalize") || msg.includes("end session")) {
      return { type: "settle" };
    }

    // Balance check
    if (msg.includes("balance") || msg.includes("how much") || msg.includes("portfolio") || msg.includes("status")) {
      const asset = msg.includes("eth") ? "ETH" as Asset : "USDC" as Asset;
      return { type: "balance", asset };
    }

    // Parse swap/simulate with amounts
    const swapMatch = msg.match(
      /(?:swap|exchange|trade|convert|buy|sell)\s+(?:about\s+)?(\d+(?:\.\d+)?)\s*(usdc|eth)\s*(?:to|for|into|→)\s*(usdc|eth)/i,
    );

    if (swapMatch) {
      return {
        type: "swap",
        amount: parseFloat(swapMatch[1]),
        tokenIn: swapMatch[2].toUpperCase() as Asset,
        tokenOut: swapMatch[3].toUpperCase() as Asset,
      };
    }

    const simMatch = msg.match(
      /(?:simulate|preview|estimate|sim)\s+(?:swapping?\s+)?(?:about\s+)?(\d+(?:\.\d+)?)\s*(usdc|eth)\s*(?:to|for|into|→)\s*(usdc|eth)/i,
    );

    if (simMatch) {
      return {
        type: "simulate",
        amount: parseFloat(simMatch[1]),
        tokenIn: simMatch[2].toUpperCase() as Asset,
        tokenOut: simMatch[3].toUpperCase() as Asset,
      };
    }

    // Generic "buy ETH" / "sell ETH"
    const buyMatch = msg.match(/buy\s+(?:some\s+)?(\d+(?:\.\d+)?)?\s*(eth|usdc)/i);
    if (buyMatch) {
      const target = buyMatch[2].toUpperCase() as Asset;
      const amount = buyMatch[1] ? parseFloat(buyMatch[1]) : 20;
      return {
        type: "swap",
        tokenIn: target === "ETH" ? "USDC" : "ETH",
        tokenOut: target,
        amount,
      };
    }

    return { type: "unknown" };
  }

  // ---- Tool Execution ----

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.tools) {
      return { success: false, error: "No active session — tools unavailable" };
    }

    try {
      switch (name) {
        case "get_balance":
          return await this.tools.getBalance(args.asset as Asset);

        case "simulate_swap":
          return await this.tools.simulateSwap(
            args.tokenIn as Asset,
            args.tokenOut as Asset,
            args.amount as number,
          );

        case "propose_swap":
          return await this.tools.proposeSwap(
            args.tokenIn as Asset,
            args.tokenOut as Asset,
            args.amount as number,
          );

        case "close_session":
          return await this.tools.closeSession();

        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      this.log.error(`Tool ${name} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private summarizeToolResults(results: AgentMessage[]): string {
    const toolResults = results
      .filter((r) => r.toolResult)
      .map((r) => `${r.toolCall?.name}: ${JSON.stringify(r.toolResult?.result).slice(0, 200)}`)
      .join("\n");
    return `Here's what I found:\n${toolResults}`;
  }
}

// ---- Factory ----

export function createAgent(): SentinelAgent {
  const provider = (process.env.AI_PROVIDER ?? "heuristic") as AgentConfig["provider"];
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  const model = process.env.AI_MODEL;

  return new SentinelAgent({
    provider: apiKey ? provider : "heuristic",
    apiKey,
    model,
  });
}

// ---- LLM Response Types ----

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}

interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface AnthropicResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
}

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
