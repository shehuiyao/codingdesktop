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

function groupByDate(entries: HistoryEntry[]): GroupedHistory[] {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const groups: Record<string, HistoryEntry[]> = {};
  const order: string[] = [];

  function addToGroup(label: string, entry: HistoryEntry) {
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(entry);
  }

  // Sort entries by timestamp descending (most recent first)
  const sorted = [...entries].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  for (const entry of sorted) {
    if (!entry.timestamp) {
      addToGroup("Older", entry);
      continue;
    }
    const date = new Date(entry.timestamp);
    const dateStr = date.toDateString();

    if (dateStr === todayStr) {
      addToGroup("Today", entry);
    } else if (dateStr === yesterdayStr) {
      addToGroup("Yesterday", entry);
    } else if (date >= sevenDaysAgo) {
      addToGroup("Past 7 Days", entry);
    } else if (date >= thirtyDaysAgo) {
      addToGroup("Past 30 Days", entry);
    } else {
      addToGroup("Older", entry);
    }
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
      setHistory(groupByDate(entries));
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
