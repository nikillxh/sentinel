"use client";

export default function Header({
  status,
  sessionId,
  policyHash,
}: {
  status: string;
  sessionId: string | null;
  policyHash: string;
}) {
  const statusColor: Record<string, string> = {
    none: "bg-gray-500",
    active: "bg-sentinel-green",
    closing: "bg-sentinel-yellow",
    settled: "bg-sentinel-accent",
  };

  return (
    <header className="border-b border-sentinel-border bg-sentinel-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl">🛡️</div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Sentinel
            </h1>
            <p className="text-xs text-sentinel-muted">
              Policy-Governed MCP Wallet
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Policy Hash */}
          <div className="hidden md:block text-right">
            <p className="text-[10px] text-sentinel-muted uppercase tracking-wider">
              Policy Hash
            </p>
            <p className="text-xs font-mono text-gray-400">
              {policyHash.slice(0, 10)}...{policyHash.slice(-6)}
            </p>
          </div>

          {/* Session */}
          <div className="text-right">
            <p className="text-[10px] text-sentinel-muted uppercase tracking-wider">
              Session
            </p>
            <p className="text-xs font-mono text-gray-400">
              {sessionId ?? "—"}
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${statusColor[status] ?? "bg-gray-500"} ${
                status === "active" ? "pulse-green" : ""
              }`}
            />
            <span className="text-sm font-medium capitalize text-gray-300">
              {status}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
