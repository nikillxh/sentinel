"use client";

import { useState } from "react";

interface SwapPanelProps {
  onSwapComplete: () => void;
  sessionActive: boolean;
}

interface SimResult {
  estimatedAmountOut: number;
  priceImpactBps: number;
  route: string;
  policyApproved: boolean;
  policyDecision?: {
    results: Array<{
      ruleId: string;
      ruleName: string;
      passed: boolean;
      reason?: string;
      value: number | string;
      limit: number | string;
    }>;
  };
}

export default function SwapPanel({ onSwapComplete, sessionActive }: SwapPanelProps) {
  const [tokenIn, setTokenIn] = useState<"USDC" | "ETH">("USDC");
  const [tokenOut, setTokenOut] = useState<"USDC" | "ETH">("ETH");
  const [amount, setAmount] = useState("");
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [swapStatus, setSwapStatus] = useState<"idle" | "simulating" | "swapping" | "success" | "rejected">("idle");
  const [error, setError] = useState<string | null>(null);

  const flipTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setSimResult(null);
    setSwapStatus("idle");
  };

  const simulate = async () => {
    if (!amount || Number(amount) <= 0) return;
    setSwapStatus("simulating");
    setError(null);
    setSimResult(null);

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenIn, tokenOut, amountIn: Number(amount) }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setSwapStatus("idle");
      } else {
        setSimResult(data);
        setSwapStatus("idle");
      }
    } catch {
      setError("Simulation failed");
      setSwapStatus("idle");
    }
  };

  const execute = async () => {
    if (!amount || Number(amount) <= 0) return;
    setSwapStatus("swapping");
    setError(null);

    try {
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenIn, tokenOut, amountIn: Number(amount) }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setSwapStatus("idle");
      } else if (data.result) {
        setSwapStatus("success");
        setSimResult(null);
        onSwapComplete();
        setTimeout(() => setSwapStatus("idle"), 2000);
      } else {
        // Rejected by policy
        setSwapStatus("rejected");
        setSimResult({
          estimatedAmountOut: 0,
          priceImpactBps: 0,
          route: "",
          policyApproved: false,
          policyDecision: data.policyDecision,
        });
        onSwapComplete();
        setTimeout(() => setSwapStatus("idle"), 3000);
      }
    } catch {
      setError("Swap failed");
      setSwapStatus("idle");
    }
  };

  return (
    <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-fade-in">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span>⚡</span> Swap
      </h2>

      {/* Token Inputs */}
      <div className="space-y-3">
        {/* From */}
        <div className="bg-sentinel-bg rounded-lg p-4">
          <div className="flex justify-between text-xs text-sentinel-muted mb-2">
            <span>From</span>
            <span>{tokenIn}</span>
          </div>
          <div className="flex gap-3">
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setSimResult(null);
                setSwapStatus("idle");
              }}
              placeholder="0.00"
              className="flex-1 bg-transparent text-xl font-mono text-white outline-none placeholder-gray-600"
              disabled={!sessionActive}
            />
            <button
              onClick={flipTokens}
              className="px-3 py-1 bg-sentinel-border rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-600 transition-colors"
            >
              {tokenIn === "USDC" ? "💵 USDC" : "⟠ ETH"}
            </button>
          </div>
        </div>

        {/* Flip */}
        <div className="flex justify-center">
          <button
            onClick={flipTokens}
            className="p-2 bg-sentinel-border rounded-full hover:bg-gray-600 transition-colors"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* To */}
        <div className="bg-sentinel-bg rounded-lg p-4">
          <div className="flex justify-between text-xs text-sentinel-muted mb-2">
            <span>To (estimated)</span>
            <span>{tokenOut}</span>
          </div>
          <p className="text-xl font-mono text-white">
            {simResult && simResult.estimatedAmountOut > 0
              ? tokenOut === "USDC"
                ? simResult.estimatedAmountOut.toFixed(2)
                : simResult.estimatedAmountOut.toFixed(8)
              : "—"}
          </p>
        </div>
      </div>

      {/* Simulation Result */}
      {simResult && (
        <div className="mt-4 space-y-2 text-xs">
          {simResult.route && (
            <div className="flex justify-between text-sentinel-muted">
              <span>Route</span>
              <span className="font-mono">{simResult.route}</span>
            </div>
          )}
          {simResult.priceImpactBps > 0 && (
            <div className="flex justify-between text-sentinel-muted">
              <span>Price Impact</span>
              <span className={`font-mono ${simResult.priceImpactBps > 100 ? "text-sentinel-red" : ""}`}>
                {(simResult.priceImpactBps / 100).toFixed(2)}%
              </span>
            </div>
          )}

          {/* Policy Rules */}
          {simResult.policyDecision && (
            <div className="mt-3 pt-3 border-t border-sentinel-border">
              <p className="text-sentinel-muted mb-2 uppercase tracking-wider text-[10px]">Policy Check</p>
              {simResult.policyDecision.results.map((r) => (
                <div key={r.ruleId} className="flex items-center gap-2 py-0.5">
                  <span>{r.passed ? "✅" : "❌"}</span>
                  <span className={r.passed ? "text-gray-400" : "text-sentinel-red"}>
                    {r.ruleName}
                  </span>
                  {!r.passed && r.reason && (
                    <span className="text-sentinel-red/70 ml-auto text-[10px]">{r.reason}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-3 bg-sentinel-red/10 border border-sentinel-red/30 text-sentinel-red text-xs rounded-lg p-3">
          {error}
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          onClick={simulate}
          disabled={!sessionActive || !amount || swapStatus === "simulating"}
          className="py-2.5 rounded-lg border border-sentinel-border text-sm font-medium text-gray-300 hover:bg-sentinel-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {swapStatus === "simulating" ? "Simulating..." : "Simulate"}
        </button>
        <button
          onClick={execute}
          disabled={!sessionActive || !amount || swapStatus === "swapping"}
          className={`py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            swapStatus === "success"
              ? "bg-sentinel-green text-white"
              : swapStatus === "rejected"
                ? "bg-sentinel-red text-white"
                : "bg-sentinel-accent text-white hover:bg-blue-600"
          }`}
        >
          {swapStatus === "swapping"
            ? "Executing..."
            : swapStatus === "success"
              ? "✓ Success"
              : swapStatus === "rejected"
                ? "✗ Rejected"
                : "Execute Swap"}
        </button>
      </div>
    </div>
  );
}
