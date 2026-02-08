"use client";

import { useState } from "react";

interface SessionControlsProps {
  status: string;
  onSessionOpen: () => void;
  onSessionClose: () => void;
}

export default function SessionControls({
  status,
  onSessionOpen,
  onSessionClose,
}: SessionControlsProps) {
  const [deposit, setDeposit] = useState("1000");
  const [loading, setLoading] = useState(false);

  const openSession = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositUsdc: Number(deposit) }),
      });
      const data = await res.json();
      if (!data.error) onSessionOpen();
    } finally {
      setLoading(false);
    }
  };

  const closeSession = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/session", { method: "DELETE" });
      const data = await res.json();
      if (!data.error) onSessionClose();
    } finally {
      setLoading(false);
    }
  };

  if (status === "none" || status === "settled") {
    return (
      <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-fade-in">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span>🚀</span> Start Session
        </h2>
        <p className="text-sm text-sentinel-muted mb-4">
          Open a new session with a USDC deposit. All swaps execute instantly off-chain.
        </p>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-sentinel-muted mb-1 block">
              Deposit (USDC)
            </label>
            <input
              type="number"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              className="w-full bg-sentinel-bg border border-sentinel-border rounded-lg px-4 py-2.5 text-white font-mono outline-none focus:border-sentinel-accent transition-colors"
            />
          </div>
          <button
            onClick={openSession}
            disabled={loading || !deposit}
            className="self-end px-6 py-2.5 bg-sentinel-green text-white rounded-lg font-medium hover:bg-emerald-600 transition-colors disabled:opacity-40"
          >
            {loading ? "Opening..." : "Open Session"}
          </button>
        </div>
      </div>
    );
  }

  if (status === "active") {
    return (
      <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sentinel-green pulse-green" />
              Session Active
            </h2>
            <p className="text-sm text-sentinel-muted mt-1">
              Execute swaps or close the session to settle on-chain.
            </p>
          </div>
          <button
            onClick={closeSession}
            disabled={loading}
            className="px-5 py-2 bg-sentinel-red/10 border border-sentinel-red/30 text-sentinel-red rounded-lg font-medium hover:bg-sentinel-red/20 transition-colors disabled:opacity-40"
          >
            {loading ? "Closing..." : "Close & Settle"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
