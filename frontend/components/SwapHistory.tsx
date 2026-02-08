"use client";

interface SwapHistoryProps {
  history: Array<{
    proposalId: string;
    amountIn: number;
    amountOut: number;
    executedPrice: number;
    timestamp: string;
  }>;
}

export default function SwapHistory({ history }: SwapHistoryProps) {
  if (history.length === 0) return null;

  return (
    <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-fade-in">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span>📜</span> Swap History
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-sentinel-muted text-xs uppercase tracking-wider">
              <th className="text-left py-2 pr-4">Proposal</th>
              <th className="text-right py-2 pr-4">Amount In</th>
              <th className="text-right py-2 pr-4">Amount Out</th>
              <th className="text-right py-2 pr-4">Price</th>
              <th className="text-right py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {history.map((swap) => (
              <tr
                key={swap.proposalId}
                className="border-t border-sentinel-border/50"
              >
                <td className="py-2.5 pr-4 font-mono text-gray-400 text-xs">
                  {swap.proposalId}
                </td>
                <td className="py-2.5 pr-4 text-right font-mono text-sentinel-red">
                  -{swap.amountIn.toFixed(2)}
                </td>
                <td className="py-2.5 pr-4 text-right font-mono text-sentinel-green">
                  +{swap.amountOut.toFixed(8)}
                </td>
                <td className="py-2.5 pr-4 text-right font-mono text-gray-400">
                  {swap.executedPrice.toFixed(8)}
                </td>
                <td className="py-2.5 text-right text-sentinel-muted text-xs">
                  {new Date(swap.timestamp).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
