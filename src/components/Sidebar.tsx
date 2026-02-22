import { useHistory, type HistoryEntry } from "../hooks/useHistory";

interface SidebarProps {
  activeSessionId: string | null;
  onSelectSession: (projectSlug: string, sessionId: string) => void;
  onNewSession: () => void;
}

function sessionLabel(entry: HistoryEntry): string {
  if (entry.display) return entry.display;
  if (entry.sessionId) return entry.sessionId.slice(0, 8) + "...";
  return "Untitled";
}

export default function Sidebar({ activeSessionId, onSelectSession, onNewSession }: SidebarProps) {
  const { history, loading, error, refetch } = useHistory();

  return (
    <div className="w-60 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)] overflow-hidden">
      <div className="p-3 border-b border-[var(--border-color)]">
        <button
          onClick={onNewSession}
          className="w-full py-2 px-3 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--accent-blue)] hover:text-white rounded transition-colors cursor-pointer"
        >
          + New Session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="text-xs text-[var(--text-secondary)] p-2">Loading...</div>
        )}
        {error && (
          <div className="text-xs text-[var(--accent-red)] p-2">
            <div>Failed to load history</div>
            <button
              onClick={refetch}
              className="mt-1 underline hover:text-[var(--text-primary)] cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && history.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] p-2">No sessions yet</div>
        )}
        {history.map((group) => (
          <div key={group.label} className="mb-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] px-2 py-1">
              {group.label}
            </div>
            {group.entries.map((entry) => {
              const isActive = entry.sessionId === activeSessionId;
              return (
                <button
                  key={entry.sessionId ?? entry.timestamp}
                  onClick={() => {
                    if (entry.project && entry.sessionId) {
                      onSelectSession(entry.project, entry.sessionId);
                    }
                  }}
                  disabled={!entry.project || !entry.sessionId}
                  className={`w-full text-left px-2 py-1.5 text-xs rounded cursor-pointer truncate block transition-colors ${
                    isActive
                      ? "bg-[var(--accent-blue)] text-white"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  } disabled:opacity-50 disabled:cursor-default`}
                  title={entry.display ?? undefined}
                >
                  {sessionLabel(entry)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
