"use client";

interface PolicyData {
  maxTradePercent: number;
  maxSlippageBps: number;
  allowedDexes: string[];
  allowedAssets: string[];
  policyHash: string;
}

export default function PolicyPanel({ policy }: { policy: PolicyData | null }) {
  if (!policy) return null;

  const rules = [
    {
      icon: "📊",
      label: "Max Trade Size",
      value: `${policy.maxTradePercent}% of balance`,
      detail: "Per-swap cap relative to session balance",
    },
    {
      icon: "🔀",
      label: "Allowed DEXes",
      value: policy.allowedDexes.join(", "),
      detail: "Only these DEXes can be used",
    },
    {
      icon: "🪙",
      label: "Allowed Assets",
      value: policy.allowedAssets.join(", "),
      detail: "Both tokenIn and tokenOut must match",
    },
    {
      icon: "📉",
      label: "Max Slippage",
      value: `${policy.maxSlippageBps} bps (${(policy.maxSlippageBps / 100).toFixed(1)}%)`,
      detail: "Protects against sandwich attacks",
    },
  ];

  return (
    <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-fade-in">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span>🔒</span> Policy Rules
      </h2>

      <div className="space-y-3">
        {rules.map((r) => (
          <div
            key={r.label}
            className="flex items-start gap-3 p-3 bg-sentinel-bg rounded-lg"
          >
            <span className="text-lg mt-0.5">{r.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">{r.label}</p>
                <p className="text-sm font-mono text-sentinel-accent">{r.value}</p>
              </div>
              <p className="text-xs text-sentinel-muted mt-0.5">{r.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-sentinel-border">
        <div className="flex items-center justify-between text-xs">
          <span className="text-sentinel-muted">Policy Hash (SHA-256)</span>
          <span className="font-mono text-gray-400 truncate ml-4">
            {policy.policyHash}
          </span>
        </div>
      </div>
    </div>
  );
}
