"use client";

interface BalanceData {
  asset: string;
  amount: number;
  initialAmount: number;
  pnl: number;
  valueUsd: number;
}

export default function BalanceCards({
  balances,
  totalValueUsd,
}: {
  balances: BalanceData[];
  totalValueUsd: number;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {balances.map((b) => (
        <div
          key={b.asset}
          className="bg-sentinel-card border border-sentinel-border rounded-xl p-5 animate-fade-in"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">
                {b.asset === "USDC" ? "💵" : "⟠"}
              </span>
              <span className="font-semibold text-white">{b.asset}</span>
            </div>
            <span className="text-xs text-sentinel-muted">
              ${b.valueUsd.toFixed(2)}
            </span>
          </div>

          <p className="text-2xl font-bold text-white font-mono">
            {b.asset === "USDC"
              ? b.amount.toFixed(2)
              : b.amount.toFixed(8)}
          </p>

          <div className="flex items-center justify-between mt-3 text-xs">
            <span className="text-sentinel-muted">
              Initial: {b.asset === "USDC" ? b.initialAmount.toFixed(2) : b.initialAmount.toFixed(8)}
            </span>
            <span
              className={`font-mono font-medium ${
                b.pnl > 0
                  ? "text-sentinel-green"
                  : b.pnl < 0
                    ? "text-sentinel-red"
                    : "text-sentinel-muted"
              }`}
            >
              {b.pnl >= 0 ? "+" : ""}
              {b.asset === "USDC" ? b.pnl.toFixed(2) : b.pnl.toFixed(8)}
            </span>
          </div>
        </div>
      ))}

      {/* Total Value */}
      <div className="bg-gradient-to-br from-sentinel-accent/10 to-sentinel-card border border-sentinel-accent/30 rounded-xl p-5 animate-fade-in">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">💰</span>
          <span className="font-semibold text-white">Total Value</span>
        </div>
        <p className="text-2xl font-bold text-white font-mono">
          ${totalValueUsd.toFixed(2)}
        </p>
        <p className="text-xs text-sentinel-muted mt-3">
          Based on mock prices (ETH = $2,500)
        </p>
      </div>
    </div>
  );
}
