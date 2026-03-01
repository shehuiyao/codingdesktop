import { useState, useEffect } from "react";
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
    <div className="w-72 border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex flex-col overflow-hidden">
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
            >
              <div
                className="text-xs text-[var(--text-primary)] truncate hover:whitespace-normal hover:break-words"
                title={commit.message}
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
    </div>
  );
}
