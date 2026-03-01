import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CommitEntry {
  hash: string;
  message: string;
  author: string;
  time_ago: string;
}

interface CommitHistoryProps {
  workingDir: string;
}

export default function CommitHistory({ workingDir }: CommitHistoryProps) {
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tooltip, setTooltip] = useState<{ text: string; top: number; right: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback((e: React.MouseEvent, message: string) => {
    // 只有文本被截断时才显示 tooltip
    const target = e.currentTarget as HTMLElement;
    const msgEl = target.querySelector("[data-msg]") as HTMLElement | null;
    if (msgEl && msgEl.scrollWidth <= msgEl.clientWidth) return;

    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      setTooltip({
        text: message,
        top: rect.top - containerRect.top,
        right: 0,
      });
    }, 300);
  }, []);

  const hideTooltip = useCallback(() => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }, []);

  useEffect(() => {
    if (!workingDir) return;
    setLoading(true);
    setError(null);
    invoke<CommitEntry[]>("get_commit_history", {
      path: workingDir,
      count: 20,
    })
      .then((result) => {
        setCommits(result);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setCommits([]);
        setLoading(false);
      });
  }, [workingDir]);

  return (
    <div ref={containerRef} className="w-72 border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex flex-col overflow-hidden relative">
      <div className="px-3 py-2 text-[10px] font-medium text-[var(--text-muted)] border-b border-[var(--border-subtle)] uppercase tracking-wider">
        Commits
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
            Loading...
          </div>
        ) : error ? (
          <div className="px-3 py-2 text-xs text-[var(--accent-red)]">
            {error}
          </div>
        ) : commits.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">
            No commits
          </div>
        ) : (
          commits.map((commit) => (
            <div
              key={commit.hash}
              className="px-3 py-1.5 hover:bg-[var(--bg-hover)] transition-colors duration-100"
              onMouseEnter={(e) => showTooltip(e, commit.message)}
              onMouseLeave={hideTooltip}
            >
              <div
                data-msg
                className="text-xs text-[var(--text-primary)] truncate"
              >
                {commit.message}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5 font-mono">
                {commit.hash} · {commit.author} · {commit.time_ago}
              </div>
            </div>
          ))
        )}
      </div>
      {/* 右侧浮层 tooltip */}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            top: tooltip.top,
            left: "100%",
            marginLeft: 4,
            maxWidth: 280,
          }}
        >
          <div className="px-2.5 py-1.5 text-xs text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded shadow-lg whitespace-pre-wrap break-words">
            {tooltip.text}
          </div>
        </div>
      )}
    </div>
  );
}
