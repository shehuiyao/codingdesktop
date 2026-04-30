import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface HistoryEntry {
  display: string | null;
  timestamp: string | null;
  project: string | null;
  sessionId: string | null;
  tool: string | null;
}

export interface GroupedHistory {
  label: string;
  entries: HistoryEntry[];
}

const HISTORY_VISIBLE_MONTHS = 1;
const HISTORY_REFRESH_INTERVAL_MS = 15_000;

/** Parse a timestamp that may be an epoch-ms number string or an ISO date string. */
function parseTimestamp(ts: string): number {
  const num = Number(ts);
  if (!isNaN(num) && num > 1e12) return num; // epoch milliseconds
  if (!isNaN(num) && num > 1e9) return num * 1000; // epoch seconds
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Extract a short project name from a full path like "/Users/foo/my-project" → "my-project" */
function projectLabel(project: string): string {
  const normalized = project.replace(/\/+$/, "");
  const worktreeMatch = normalized.match(/\/\.codex\/worktrees\/([^/]+)\/([^/]+)$/);
  if (worktreeMatch) {
    return `${worktreeMatch[2]} · worktree/${worktreeMatch[1]}`;
  }

  const parts = normalized.split("/");
  return parts[parts.length - 1] || project;
}

function oneMonthAgo(): number {
  const date = new Date();
  date.setMonth(date.getMonth() - HISTORY_VISIBLE_MONTHS);
  return date.getTime();
}

function filterRecentEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const cutoff = oneMonthAgo();
  return entries.filter((entry) => {
    if (!entry.timestamp) return false;
    return parseTimestamp(entry.timestamp) >= cutoff;
  });
}

function groupByProject(entries: HistoryEntry[]): GroupedHistory[] {
  const groups: Record<string, HistoryEntry[]> = {};
  const order: string[] = [];

  // Sort entries by timestamp descending (most recent first)
  const sorted = [...entries].sort((a, b) => {
    const ta = a.timestamp ? parseTimestamp(a.timestamp) : 0;
    const tb = b.timestamp ? parseTimestamp(b.timestamp) : 0;
    return tb - ta;
  });

  for (const entry of sorted) {
    const project = entry.project || "Unknown";
    const label = projectLabel(project);
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(entry);
  }

  return order.map((label) => ({ label, entries: groups[label] }));
}

export function useHistory() {
  const [history, setHistory] = useState<GroupedHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchHistory(silent = false) {
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const entries = await invoke<HistoryEntry[]>("get_history");
      setHistory(groupByProject(filterRecentEntries(entries)));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory();

    const intervalId = window.setInterval(() => fetchHistory(true), HISTORY_REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (!document.hidden) {
        fetchHistory(true);
      }
    };
    const refreshOnFocus = () => fetchHistory(true);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return { history, loading, error, refetch: () => fetchHistory() };
}
