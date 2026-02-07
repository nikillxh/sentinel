// ============================================================
// Sentinel – On-Chain Settlement Client
// Connects the off-chain MCP session to on-chain settlement
// via the SentinelWallet + PolicyGuard contracts.
//
// This is the bridge between Yellow session close and EVM finality.
// ============================================================

import {
  type ContractTransactionResponse,
  type ContractTransactionReceipt,
  type Log,
  type LogDescription,
  Contract,
  JsonRpcProvider,
  Wallet,
  id as ethersId,
  parseUnits,
  formatUnits,
  formatEther,
  Interface,
} from "ethers";
import { Logger } from "../shared/logger.js";
import { CHAIN, TOKENS } from "../shared/constants.js";
import { SENTINEL_WALLET_ABI, POLICY_GUARD_ABI } from "./abis.js";
import type { SessionState, SettlementRecord } from "../shared/types.js";

export interface SettlementConfig {
  rpcUrl: string;
  /** Operator private key — NOT the AI agent's key */
  operatorPrivateKey: string;
  walletAddress: string;
  policyGuardAddress: string;
}

export class SettlementClient {
  private provider: JsonRpcProvider;
  private operator: Wallet;
  private walletContract: Contract;
  private guardContract: Contract;
  private walletIface: Interface;
  private log = new Logger("settlement");

  constructor(config: SettlementConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.operator = new Wallet(config.operatorPrivateKey, this.provider);

    this.walletContract = new Contract(
      config.walletAddress,
      SENTINEL_WALLET_ABI,
      this.operator,
    );

    this.guardContract = new Contract(
      config.policyGuardAddress,
      POLICY_GUARD_ABI,
      this.operator,
    );

    this.walletIface = new Interface(SENTINEL_WALLET_ABI);

    this.log.info("Settlement client initialized", {
      chain: CHAIN.name,
      walletAddress: config.walletAddress,
      policyGuardAddress: config.policyGuardAddress,
      operator: this.operator.address,
    });
  }

  /**
   * Settle a session on-chain.
   *
   * Flow:
   *   1. Encode the session ID as bytes32
   *   2. Convert balances to on-chain amounts (with decimals)
   *   3. Call SentinelWallet.settleSession()
   *   4. Wait for confirmation
   *   5. Parse events from the receipt
   *   6. Return the settlement record
   */
  async settle(session: SessionState): Promise<SettlementRecord> {
    this.log.separator("ON-CHAIN SETTLEMENT");
    this.log.info(`Settling session ${session.sessionId}`);

    // Step 1: Encode session ID
    const sessionIdBytes = ethersId(session.sessionId);
    this.log.debug("Session ID (bytes32):", sessionIdBytes);

    // Step 2: Get final balances
    const usdcBalance = session.balances.get("USDC");
    const ethBalance = session.balances.get("ETH");

    const usdcAmount = parseUnits(
      (usdcBalance?.amount ?? 0).toFixed(TOKENS.USDC.decimals),
      TOKENS.USDC.decimals,
    );
    const ethAmount = parseUnits(
      (ethBalance?.amount ?? 0).toFixed(TOKENS.ETH.decimals),
      TOKENS.ETH.decimals,
    );

    this.log.info("Settlement amounts:", {
      USDC: `${usdcBalance?.amount ?? 0} (${usdcAmount.toString()} wei)`,
      ETH: `${ethBalance?.amount ?? 0} (${ethAmount.toString()} wei)`,
    });

    // Step 3: Pre-validate with PolicyGuard
    this.log.info("Pre-validating with PolicyGuard...");
    try {
      const validateFn = this.guardContract.getFunction("validateSettlement");
      await validateFn(
        sessionIdBytes,
        TOKENS.USDC.address,
        usdcAmount,
        ethAmount,
      );
      this.log.info("PolicyGuard pre-validation: ✓ PASSED");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error("PolicyGuard pre-validation FAILED", { error: message });
      throw new Error(`Settlement rejected by PolicyGuard: ${message}`);
    }

    // Step 4: Submit the settlement transaction
    this.log.info("Submitting settlement transaction...");
    const settleFn = this.walletContract.getFunction("settleSession");
    const tx: ContractTransactionResponse = await settleFn(
      sessionIdBytes,
      TOKENS.USDC.address,
      usdcAmount,
      ethAmount,
    );

    this.log.info(`Transaction submitted: ${tx.hash}`);
    this.log.info("Waiting for confirmation...");

    // Step 5: Wait for on-chain confirmation
    const receipt: ContractTransactionReceipt | null = await tx.wait(1);
    if (!receipt) {
      throw new Error("Transaction receipt not available");
    }
    this.log.info(`Confirmed in block ${receipt.blockNumber}`);

    // Step 6: Parse settlement event
    const settlementEvent = receipt.logs
      .map((log: Log) => {
        try {
          return this.walletIface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
        } catch {
          return null;
        }
      })
      .find((e: LogDescription | null) => e?.name === "SessionSettled");

    if (settlementEvent) {
      this.log.info("SessionSettled event emitted", {
        sessionId: settlementEvent.args[0],
        operator: settlementEvent.args[1],
        usdcDelta: settlementEvent.args[2].toString(),
        ethDelta: settlementEvent.args[3].toString(),
      });
    }

    // Step 7: Build settlement record
    const record: SettlementRecord = {
      sessionId: session.sessionId,
      wallet: this.walletContract.target as `0x${string}`,
      balances: [
        { asset: "USDC", amount: usdcBalance?.amount ?? 0 },
        { asset: "ETH", amount: ethBalance?.amount ?? 0 },
      ],
      txHash: tx.hash as `0x${string}`,
      blockNumber: receipt.blockNumber,
      timestamp: new Date().toISOString(),
    };

    this.log.info("Settlement complete", {
      txHash: record.txHash,
      blockNumber: record.blockNumber,
      explorerUrl: `${CHAIN.explorerUrl}/tx/${record.txHash}`,
    });

    return record;
  }

  /**
   * Check if a session has already been settled on-chain.
   */
  async isSessionSettled(sessionId: string): Promise<boolean> {
    const sessionIdBytes = ethersId(sessionId);
    const fn = this.guardContract.getFunction("settledSessions");
    return fn(sessionIdBytes);
  }

  /**
   * Get the on-chain policy hash (for ENS verification).
   */
  async getOnChainPolicyHash(): Promise<string> {
    const fn = this.guardContract.getFunction("policyHash");
    return fn();
  }

  /**
   * Get the wallet's on-chain balances.
   */
  async getOnChainBalances(): Promise<{ usdc: string; eth: string }> {
    const getUsdcFn = this.walletContract.getFunction("getUsdcBalance");
    const getEthFn = this.walletContract.getFunction("getEthBalance");

    const usdcBalance = await getUsdcFn(TOKENS.USDC.address);
    const ethBalance = await getEthFn();

    return {
      usdc: formatUnits(usdcBalance, TOKENS.USDC.decimals),
      eth: formatEther(ethBalance),
    };
  }
}

// ---- Factory ----

/**
 * Create a SettlementClient from environment variables.
 * Returns null if required env vars are missing (allows graceful fallback to mock).
 */
export function createSettlementClient(): SettlementClient | null {
  const rpcUrl = process.env.RPC_URL;
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
  const walletAddr = process.env.SENTINEL_WALLET_ADDRESS;
  const guardAddr = process.env.POLICY_GUARD_ADDRESS;

  if (!rpcUrl || !operatorKey || !walletAddr || !guardAddr) {
    return null;
  }

  // Don't initialize with placeholder values
  if (operatorKey.startsWith("0x...") || walletAddr.startsWith("0x...")) {
    return null;
  }

  return new SettlementClient({
    rpcUrl,
    operatorPrivateKey: operatorKey,
    walletAddress: walletAddr,
    policyGuardAddress: guardAddr,
  });
}
