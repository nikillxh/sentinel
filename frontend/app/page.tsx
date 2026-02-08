"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import BalanceCards from "@/components/BalanceCards";
import SwapPanel from "@/components/SwapPanel";
import PolicyPanel from "@/components/PolicyPanel";
import AuditLog from "@/components/AuditLog";
import SessionControls from "@/components/SessionControls";
import SwapHistory from "@/components/SwapHistory";
import ChatPanel from "@/components/ChatPanel";

interface SessionState {
  sessionId: string | null;
  status: string;
  balances: Record<string, number>;
  pnl: Record<string, number>;
  totalSwaps: number;
  totalValueUsd: number;
  history: Array<{
    proposalId: string;
    amountIn: number;
    amountOut: number;
    executedPrice: number;
    timestamp: string;
  }>;
  openedAt: string | null;
  closedAt: string | null;
  settlementTxHash: string | null;
  policyHash: string;
}

interface PolicyData {
  maxTradePercent: number;
  maxSlippageBps: number;
  allowedDexes: string[];
  allowedAssets: string[];
  policyHash: string;
}

interface AuditEntry {
  id: string;
  type: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

const MOCK_PRICES: Record<string, number> = { USDC: 1.0, ETH: 2500.0 };

export default function Dashboard() {
  const [session, setSession] = useState<SessionState>({
    sessionId: null,
    status: "none",
    balances: {},
    pnl: {},
    totalSwaps: 0,
    totalValueUsd: 0,
    history: [],
    openedAt: null,
    closedAt: null,
    settlementTxHash: null,
    policyHash: "",
  });
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [sessionRes, auditRes] = await Promise.all([
        fetch("/api/session"),
        fetch("/api/audit"),
      ]);
      const sessionData = await sessionRes.json();
      const auditData = await auditRes.json();
      if (!sessionData.error) setSession(sessionData);
      if (Array.isArray(auditData)) setAudit(auditData);
    } catch {
      // ignore network errors
    }
  }, []);

  // Initial load
  useEffect(() => {
    refresh();
    fetch("/api/policy")
      .then((r) => r.json())
      .then((d) => setPolicy(d))
      .catch(() => {});
  }, [refresh]);

  const balanceCards = ["USDC", "ETH"].map((asset) => ({
    asset,
    amount: session.balances[asset] ?? 0,
    initialAmount: asset === "USDC" ? (session.status !== "none" ? 1000 : 0) : 0,
    pnl: session.pnl[asset] ?? 0,
    valueUsd: (session.balances[asset] ?? 0) * (MOCK_PRICES[asset] ?? 0),
  }));

  return (
    <div className="min-h-screen">
      <Header
        status={session.status}
        sessionId={session.sessionId}
        policyHash={session.policyHash || policy?.policyHash || ""}
      />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Session Controls */}
        <SessionControls
          status={session.status}
          onSessionOpen={refresh}
          onSessionClose={refresh}
        />

        {/* Settlement Banner */}
        {session.status === "settled" && session.settlementTxHash && (
          <div className="bg-sentinel-accent/10 border border-sentinel-accent/30 rounded-xl p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="text-xl">🔗</span>
              <div>
                <p className="text-sm font-medium text-white">
                  Session Settled On-Chain
                </p>
                <p className="text-xs font-mono text-sentinel-accent mt-0.5">
                  tx: {session.settlementTxHash}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Balances */}
        {session.status !== "none" && (
          <BalanceCards
            balances={balanceCards}
            totalValueUsd={session.totalValueUsd}
          />
        )}

        {/* Main Grid: Swap + Policy */}
        {session.status === "active" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SwapPanel
              onSwapComplete={refresh}
              sessionActive={session.status === "active"}
            />
            <PolicyPanel policy={policy} />
          </div>
        )}

        {/* Policy (when not in active session) */}
        {session.status !== "active" && policy && (
          <PolicyPanel policy={policy} />
        )}

        {/* Swap History */}
        {session.history.length > 0 && (
          <SwapHistory history={session.history} />
        )}

        {/* AI Agent Chat */}
        <ChatPanel />

        {/* Audit Log */}
        <AuditLog entries={audit} />
      </main>

      {/* Footer */}
      <footer className="border-t border-sentinel-border py-6 mt-12">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-xs text-sentinel-muted">
          <span>🛡️ Sentinel — ETHGlobal HackMoney 2026</span>
          <span>Base Sepolia · Chain ID 84532</span>
        </div>
      </footer>
    </div>
  );
}
