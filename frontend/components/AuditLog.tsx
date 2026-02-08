"use client";

import { useEffect, useRef } from "react";

interface AuditEntry {
  id: string;
  type: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

const TYPE_STYLES: Record<string, { icon: string; color: string }> = {
  session_opened: { icon: "🟢", color: "text-sentinel-green" },
  session_closed: { icon: "🔴", color: "text-sentinel-red" },
  session_settled: { icon: "🔵", color: "text-sentinel-accent" },
  swap_executed: { icon: "✅", color: "text-sentinel-green" },
  swap_rejected: { icon: "❌", color: "text-sentinel-red" },
  swap_approved: { icon: "✓", color: "text-sentinel-green" },
  simulation: { icon: "🔍", color: "text-sentinel-yellow" },
};

export default function AuditLog({ entries }: { entries: AuditEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <span>📋</span> Audit Log
        </h2>
        <span className="text-xs text-sentinel-muted bg-sentinel-bg px-2 py-1 rounded">
          {entries.length} entries
        </span>
      </div>

      <div
        ref={scrollRef}
        className="space-y-1 max-h-80 overflow-y-auto pr-1"
      >
        {entries.length === 0 ? (
          <p className="text-sm text-sentinel-muted py-8 text-center">
            No audit entries yet. Open a session to begin.
          </p>
        ) : (
          entries.map((entry) => {
            const style = TYPE_STYLES[entry.type] ?? {
              icon: "•",
              color: "text-gray-400",
            };
            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 py-2 border-b border-sentinel-border/50 last:border-0"
              >
                <span className="text-xs mt-0.5">{style.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${style.color}`}>{entry.message}</p>
                  {entry.details && (
                    <pre className="text-[10px] text-sentinel-muted mt-1 font-mono overflow-hidden text-ellipsis">
                      {JSON.stringify(entry.details, null, 0).slice(0, 120)}
                    </pre>
                  )}
                </div>
                <span className="text-[10px] text-sentinel-muted whitespace-nowrap mt-0.5">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
