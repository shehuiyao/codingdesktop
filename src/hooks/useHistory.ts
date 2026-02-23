import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface HistoryEntry {
  display: string | null;
  timestamp: string | null;
  project: string | null;
  sessionId: string | null;
}

export interface GroupedHistory {
  label: string;
  entries: HistoryEntry[];
}

/** Parse a timestamp that may be an epoch-ms number string or an ISO date string. */
function parseTimestamp(ts: string): number {
  const num = Number(ts);
  if (!isNaN(num) && num > 1e12) return num; // epoch milliseconds
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Extract a short project name from a full path like "/Users/foo/my-project" → "my-project" */
function projectLabel(project: string): string {
  const parts = project.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || project;
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

  async function fetchHistory() {
    setLoading(true);
    setError(null);
    try {
      const entries = await invoke<HistoryEntry[]>("get_history");
      setHistory(groupByProject(entries));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory();
  }, []);

  return { history, loading, error, refetch: fetchHistory };
}
