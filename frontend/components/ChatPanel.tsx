"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ---- Types ----

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult?: { toolCallId: string; result: unknown };
}

interface AgentResponse {
  responses: Array<{
    message: string;
    reasoning?: string;
    action?: { type: string; params?: Record<string, unknown> };
  }>;
  history: ChatMessage[];
  provider: string;
}

// ---- Quick-Prompt Chips ----

const QUICK_PROMPTS = [
  { label: "Check balances", text: "What are my current balances?" },
  { label: "Simulate swap", text: "Simulate swapping 10 USDC to ETH" },
  { label: "Swap 5 USDC", text: "Swap 5 USDC to ETH" },
  { label: "Session summary", text: "Give me a session summary" },
];

// ---- Component ----

export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<string>("unknown");
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Load history on mount
  useEffect(() => {
    fetch("/api/agent")
      .then((r) => r.json())
      .then((data) => {
        if (data.history) setMessages(data.history);
        if (data.provider) setProvider(data.provider);
      })
      .catch(() => {});
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text.trim() }),
        });
        const data: AgentResponse = await res.json();

        if (data.responses) {
          for (const r of data.responses) {
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: r.message,
            };
            setMessages((prev) => [...prev, assistantMsg]);
          }
        }
        if (data.provider) setProvider(data.provider);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Error: ${(err as Error).message}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const handleReset = async () => {
    try {
      await fetch("/api/agent", { method: "DELETE" });
      setMessages([]);
    } catch {}
  };

  // Filter to show only user & assistant messages (not raw tool calls)
  const visibleMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  return (
    <div className="bg-sentinel-card border border-sentinel-border rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sentinel-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-white font-medium text-sm hover:text-sentinel-accent transition-colors"
        >
          <span className="text-lg">🤖</span>
          <span>AI Agent</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-sentinel-accent/20 text-sentinel-accent rounded-full uppercase tracking-wider">
            {provider}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        <button
          onClick={handleReset}
          className="text-xs text-sentinel-muted hover:text-red-400 transition-colors"
          title="Reset conversation"
        >
          ✕ Reset
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px] max-h-[400px]"
          >
            {visibleMessages.length === 0 && !loading && (
              <div className="text-center text-sentinel-muted text-sm py-8">
                <p className="text-2xl mb-2">🛡️</p>
                <p>
                  Hi! I&apos;m <strong className="text-white">Sentinel</strong>,
                  your AI trading agent.
                </p>
                <p className="mt-1">
                  Ask me to check balances, simulate or execute swaps.
                </p>
              </div>
            )}

            {visibleMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-sentinel-accent/20 text-white border border-sentinel-accent/30"
                      : "bg-sentinel-surface text-gray-200 border border-sentinel-border"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-sentinel-surface border border-sentinel-border rounded-xl px-4 py-2.5 text-sm text-sentinel-muted">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: "0ms" }}>●</span>
                    <span className="animate-bounce" style={{ animationDelay: "150ms" }}>●</span>
                    <span className="animate-bounce" style={{ animationDelay: "300ms" }}>●</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          {visibleMessages.length === 0 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => send(p.text)}
                  disabled={loading}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-sentinel-surface border border-sentinel-border text-sentinel-muted hover:text-white hover:border-sentinel-accent/40 transition-colors disabled:opacity-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-4 py-3 border-t border-sentinel-border"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Sentinel to trade, simulate, or check balances…"
              disabled={loading}
              className="flex-1 bg-sentinel-surface border border-sentinel-border rounded-lg px-3 py-2 text-sm text-white placeholder-sentinel-muted focus:outline-none focus:border-sentinel-accent/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-sentinel-accent text-black hover:bg-sentinel-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
