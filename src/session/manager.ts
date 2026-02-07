// ============================================================
// Sentinel – Session Manager
// Off-chain balance tracking via Yellow/Nitrolite session model.
// All balance updates are instant and gasless during the session.
// Settlement happens once when the session closes.
//
// When a NitroliteChannel is provided, every balance change is
// co-signed via the Nitrolite state channel protocol, giving
// us cryptographic guarantees for off-chain execution.
// ============================================================

import { randomUUID } from "node:crypto";
import { Logger } from "../shared/logger.js";
import { MOCK_PRICES, SESSION } from "../shared/constants.js";
import type {
  Asset,
  SessionBalance,
  SessionState,
  SessionStatus,
  SwapResult,
} from "../shared/types.js";
import type { NitroliteChannel } from "./channel.js";

export class SessionManager {
  private session: SessionState | null = null;
  private log = new Logger("session");
  private channel: NitroliteChannel | null;

  constructor(channel?: NitroliteChannel | null) {
    this.channel = channel ?? null;
    if (this.channel) {
      this.log.info("Session manager initialized with Nitrolite channel ✓");
    } else {
      this.log.info("Session manager initialized (in-memory mode)");
    }
  }

  // ---- Session Lifecycle ----

  /**
   * Open a new session with an initial USDC deposit.
   * When a NitroliteChannel is configured, this also opens a
   * state channel with the broker for co-signed state updates.
   */
  async open(depositUsdc: number = SESSION.defaultDepositUsdc): Promise<SessionState> {
    if (this.session && this.session.status === "active") {
      throw new Error("A session is already active. Close it before opening a new one.");
    }

    const sessionId = `session-${randomUUID().slice(0, 8)}`;
    const balances = new Map<Asset, SessionBalance>();

    balances.set("USDC", {
      asset: "USDC",
      amount: depositUsdc,
      initialAmount: depositUsdc,
      pnl: 0,
    });

    balances.set("ETH", {
      asset: "ETH",
      amount: 0,
      initialAmount: 0,
      pnl: 0,
    });

    this.session = {
      sessionId,
      status: "active",
      balances,
      history: [],
      openedAt: new Date().toISOString(),
    };

    // Open Nitrolite channel if configured
    if (this.channel) {
      try {
        await this.channel.connect();
        const ch = await this.channel.openChannel(balances);
        this.log.info(`Nitrolite channel opened: ${ch.channelId}`);
      } catch (err) {
        this.log.warn("Failed to open Nitrolite channel, continuing in-memory", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.log.transition("none", "active", `Session ${sessionId} opened with ${depositUsdc} USDC`);
    return this.session;
  }

  /**
   * Get the current session state. Throws if no session is active.
   */
  getSession(): SessionState {
    if (!this.session) {
      throw new Error("No active session. Call open() first.");
    }
    return this.session;
  }

  /**
   * Get the balance of a specific asset in the current session.
   */
  getBalance(asset: Asset): SessionBalance {
    const session = this.getSession();
    const balance = session.balances.get(asset);
    if (!balance) {
      throw new Error(`No balance entry for ${asset}`);
    }
    return { ...balance };
  }

  /**
   * Get all balances as a Map (for policy engine).
   */
  getBalances(): Map<Asset, SessionBalance> {
    return this.getSession().balances;
  }

  /**
   * Get the session status.
   */
  getStatus(): SessionStatus {
    return this.session?.status ?? "settled";
  }

  // ---- Off-Chain Execution ----

  /**
   * Apply a swap result to the session balances.
   * This is the "instant, gasless" off-chain execution.
   * When a Nitrolite channel is active, the new state is co-signed.
   *
   * IMPORTANT: Only call this AFTER the policy engine has approved the swap.
   */
  async applySwap(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
    amountOut: number,
    proposalId: string,
  ): Promise<SwapResult> {
    const session = this.getSession();
    this.assertActive();

    const balanceIn = session.balances.get(tokenIn);
    const balanceOut = session.balances.get(tokenOut);

    if (!balanceIn || !balanceOut) {
      throw new Error(`Missing balance for ${tokenIn} or ${tokenOut}`);
    }

    if (balanceIn.amount < amountIn) {
      throw new Error(
        `Insufficient ${tokenIn} balance: have ${balanceIn.amount}, need ${amountIn}`,
      );
    }

    // Apply the balance changes
    balanceIn.amount -= amountIn;
    balanceIn.pnl = balanceIn.amount - balanceIn.initialAmount;

    balanceOut.amount += amountOut;
    balanceOut.pnl = balanceOut.amount - balanceOut.initialAmount;

    const result: SwapResult = {
      proposalId,
      success: true,
      amountIn,
      amountOut,
      executedPrice: amountOut / amountIn,
      executionType: "offchain",
      timestamp: new Date().toISOString(),
    };

    session.history.push(result);

    // Update Nitrolite channel state (co-sign new balances)
    if (this.channel) {
      try {
        const state = await this.channel.updateState(session.balances);
        this.log.debug(`Channel state updated: turn ${state.turnNum}`, {
          stateHash: state.stateHash,
        });
      } catch (err) {
        this.log.warn("Failed to update channel state", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.log.info(
      `Swap executed off-chain: ${amountIn} ${tokenIn} → ${amountOut.toFixed(6)} ${tokenOut}`,
      { proposalId, executedPrice: result.executedPrice },
    );
    this.log.debug("Updated balances", {
      [tokenIn]: balanceIn.amount,
      [tokenOut]: balanceOut.amount,
    });

    // Check session action limit
    if (session.history.length >= SESSION.maxActionsPerSession) {
      this.log.warn(`Session action limit reached (${SESSION.maxActionsPerSession})`);
    }

    return result;
  }

  // ---- Session Close & Settlement ----

  /**
   * Close the session and prepare for on-chain settlement.
   * Returns the final session state with all balances.
   *
   * When a Nitrolite channel is active, this cooperatively closes
   * the channel — both parties sign the final state, which can
   * then be submitted on-chain for settlement.
   */
  async close(): Promise<SessionState> {
    const session = this.getSession();
    this.assertActive();

    this.log.transition("active", "closing", `Session ${session.sessionId}`);
    session.status = "closing";

    // Close Nitrolite channel if active
    if (this.channel) {
      try {
        const ch = await this.channel.closeChannel();
        this.log.info(`Nitrolite channel finalized: ${ch.channelId}`, {
          totalStateUpdates: ch.stateHistory.length,
        });
        await this.channel.disconnect();
      } catch (err) {
        this.log.warn("Failed to close Nitrolite channel", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.log.info("Session summary", {
      sessionId: session.sessionId,
      totalSwaps: session.history.length,
      finalBalances: {
        USDC: session.balances.get("USDC")?.amount,
        ETH: session.balances.get("ETH")?.amount,
      },
      duration: `${Date.now() - new Date(session.openedAt).getTime()}ms`,
    });

    return session;
  }

  /**
   * Mark the session as settled with an on-chain tx hash.
   *
   * STUB: In production this would be called after the ERC-4337
   * UserOperation is confirmed on-chain.
   */
  markSettled(txHash: `0x${string}`): SessionState {
    const session = this.getSession();
    if (session.status !== "closing") {
      throw new Error(`Cannot settle session in status "${session.status}". Must be "closing".`);
    }

    session.status = "settled";
    session.closedAt = new Date().toISOString();
    session.settlementTxHash = txHash;

    this.log.transition("closing", "settled", `tx: ${txHash}`);
    this.log.separator("SESSION SETTLED");

    return session;
  }

  /**
   * Get the total USD value of all session balances.
   * Uses mock prices — in production, use Chainlink or Uniswap TWAP.
   */
  getTotalValueUsd(): number {
    const session = this.getSession();
    let total = 0;
    for (const [asset, balance] of session.balances) {
      total += balance.amount * (MOCK_PRICES[asset] ?? 0);
    }
    return total;
  }

  /**
   * Get a human-readable summary of the session.
   */
  getSummary(): {
    sessionId: string;
    status: SessionStatus;
    balances: Record<string, number>;
    pnl: Record<string, number>;
    totalSwaps: number;
    totalValueUsd: number;
  } {
    const session = this.getSession();
    const balances: Record<string, number> = {};
    const pnl: Record<string, number> = {};

    for (const [asset, bal] of session.balances) {
      balances[asset] = bal.amount;
      pnl[asset] = bal.pnl;
    }

    return {
      sessionId: session.sessionId,
      status: session.status,
      balances,
      pnl,
      totalSwaps: session.history.length,
      totalValueUsd: this.getTotalValueUsd(),
    };
  }

  // ---- Guards ----

  private assertActive(): void {
    if (this.session?.status !== "active") {
      throw new Error(
        `Session is not active (current: "${this.session?.status ?? "none"}"). Cannot perform operations.`,
      );
    }
  }
}
