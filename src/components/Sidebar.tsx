import { useState, useEffect } from "react";
import { useHistory, type HistoryEntry } from "../hooks/useHistory";

interface SidebarProps {
  activeSessionId: string | null;
  onSelectSession: (projectSlug: string, sessionId: string) => void;
  onNewSession: () => void;
  onOpenProject: (projectPath: string) => void;
}

function sessionLabel(entry: HistoryEntry): string {
  if (entry.display) return entry.display;
  if (entry.sessionId) return entry.sessionId.slice(0, 8) + "...";
  return "Untitled";
}

const PINNED_KEY = "claude-desktop-pinned-projects";

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function savePinned(pinned: Set<string>) {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]));
}

export default function Sidebar({ activeSessionId, onSelectSession, onNewSession, onOpenProject }: SidebarProps) {
  const { history, loading, error, refetch } = useHistory();
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [allCollapsed, setAllCollapsed] = useState(true);
  const [initialCollapseApplied, setInitialCollapseApplied] = useState(false);
  const [pinnedProjects, setPinnedProjects] = useState<Set<string>>(loadPinned);

  useEffect(() => {
    savePinned(pinnedProjects);
  }, [pinnedProjects]);

  // Default collapse all projects on first load
  useEffect(() => {
    if (!initialCollapseApplied && history.length > 0) {
      setCollapsedProjects(new Set(history.map((g) => g.label)));
      setInitialCollapseApplied(true);
    }
  }, [history, initialCollapseApplied]);

  const togglePin = (label: string) => {
    setPinnedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const toggleProject = (label: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allCollapsed) {
      setCollapsedProjects(new Set());
      setAllCollapsed(false);
    } else {
      setCollapsedProjects(new Set(history.map((g) => g.label)));
      setAllCollapsed(true);
    }
  };

  const filteredHistory = searchQuery.trim()
    ? history
        .map((group) => ({
          ...group,
          entries: group.entries.filter((entry) => {
            const query = searchQuery.toLowerCase();
            const display = (entry.display || "").toLowerCase();
            const project = (entry.project || "").toLowerCase();
            return display.includes(query) || project.includes(query);
          }),
        }))
        .filter((group) => group.entries.length > 0)
    : history;

  // Sort: pinned projects first
  const sortedHistory = [...filteredHistory].sort((a, b) => {
    const aPinned = pinnedProjects.has(a.label);
    const bPinned = pinnedProjects.has(b.label);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return 0;
  });

  const totalSessions = history.reduce((sum, g) => sum + g.entries.length, 0);

  return (
    <div className="w-60 border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-secondary)] overflow-hidden">
      <div className="p-3 border-b border-[var(--border-subtle)]">
        <button
          onClick={onNewSession}
          className="w-full py-2 px-3 text-xs font-medium border border-[var(--border-color)] text-[var(--text-secondary)] rounded-md transition-all duration-150 cursor-pointer hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/5 active:brightness-90"
        >
          + New Session
        </button>
      </div>
      <div className="px-3 pb-2 pt-2">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-cyan)] transition-colors duration-150"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer transition-colors duration-150"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* History header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-subtle)]">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          History
          {totalSessions > 0 && (
            <span className="ml-1.5 text-[var(--text-muted)]">({totalSessions})</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={refetch}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150"
            title="Refresh"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3a5 5 0 0 0-4.546 2.914.5.5 0 1 1-.908-.418A6 6 0 0 1 14 8a6 6 0 0 1-6 6 6 6 0 0 1-5.454-3.496.5.5 0 0 1 .908-.418A5 5 0 1 0 8 3Z"/>
              <path d="M8 1a.5.5 0 0 1 .5.5V4a.5.5 0 0 1-1 0V1.5A.5.5 0 0 1 8 1Z"/>
              <path d="M5.5 3.5a.5.5 0 0 1 0-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-.5Z"/>
            </svg>
          </button>
          {history.length > 0 && (
            <button
              onClick={toggleAll}
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150"
              title={allCollapsed ? "Expand all" : "Collapse all"}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                {allCollapsed ? (
                  <path d="M1 2.5A.5.5 0 0 1 1.5 2h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 2.5Zm0 4A.5.5 0 0 1 1.5 6h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 6.5Zm0 4A.5.5 0 0 1 1.5 10h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5Zm0 4A.5.5 0 0 1 1.5 14h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5Z"/>
                ) : (
                  <path d="M1 2.5A.5.5 0 0 1 1.5 2h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 2.5Zm3 4A.5.5 0 0 1 4.5 6h10a.5.5 0 0 1 0 1h-10A.5.5 0 0 1 4 6.5Zm0 4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1h-10a.5.5 0 0 1-.5-.5Zm-3 4A.5.5 0 0 1 1.5 14h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5Z"/>
                )}
              </svg>
            </button>
          )}
        </div>
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
              className="mt-1 underline hover:text-[var(--text-primary)] cursor-pointer transition-colors duration-150"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && history.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] p-2">No sessions yet</div>
        )}
        {!loading && !error && history.length > 0 && filteredHistory.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] p-2">No matching sessions</div>
        )}
        {sortedHistory.map((group) => {
          const isCollapsed = collapsedProjects.has(group.label);
          const isPinned = pinnedProjects.has(group.label);
          const projectPath = group.entries[0]?.project;
          return (
            <div key={group.label} className="mb-1 group/project">
              <div className="flex items-center hover:bg-[var(--bg-hover)] rounded-sm transition-colors duration-150">
                <button
                  onClick={() => toggleProject(group.label)}
                  className="flex-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] px-2 py-1 font-medium cursor-pointer min-w-0"
                  title={projectPath || group.label}
                >
                  <span className="text-[8px]">{isCollapsed ? "▶" : "▼"}</span>
                  {isPinned && (
                    <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--accent-yellow)] shrink-0">
                      <path d="M4.456.734a1.75 1.75 0 0 1 2.826.504l.613 1.327a3.08 3.08 0 0 0 2.084 1.707l2.454.584c1.332.317 1.8 1.972.832 2.94L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-2.204 2.205c-.968.968-2.623.5-2.94-.832l-.584-2.454a3.08 3.08 0 0 0-1.707-2.084l-1.327-.613a1.75 1.75 0 0 1-.504-2.826L4.456.734Z"/>
                    </svg>
                  )}
                  <span className="truncate">{group.label}</span>
                </button>
                <div className="flex items-center shrink-0 pr-1 gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePin(group.label); }}
                    className={`w-5 h-5 flex items-center justify-center rounded cursor-pointer transition-all duration-150 ${
                      isPinned
                        ? "text-[var(--accent-yellow)] opacity-0 group-hover/project:opacity-100"
                        : "text-[var(--text-muted)] hover:text-[var(--accent-yellow)] opacity-0 group-hover/project:opacity-100"
                    }`}
                    title={isPinned ? "Unpin" : "Pin to top"}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4.456.734a1.75 1.75 0 0 1 2.826.504l.613 1.327a3.08 3.08 0 0 0 2.084 1.707l2.454.584c1.332.317 1.8 1.972.832 2.94L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-2.204 2.205c-.968.968-2.623.5-2.94-.832l-.584-2.454a3.08 3.08 0 0 0-1.707-2.084l-1.327-.613a1.75 1.75 0 0 1-.504-2.826L4.456.734Z"/>
                    </svg>
                  </button>
                  {projectPath && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenProject(projectPath); }}
                      className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent-cyan)] cursor-pointer opacity-0 group-hover/project:opacity-100 transition-all duration-150"
                      title="Open project"
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9Z"/>
                      </svg>
                    </button>
                  )}
                  <span className="text-[10px] text-[var(--text-muted)] min-w-[1.2em] text-right">{group.entries.length}</span>
                </div>
              </div>
              {!isCollapsed && group.entries.map((entry) => {
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
                    className={`w-full text-left px-2 py-1.5 text-xs rounded-md cursor-pointer truncate block transition-all duration-150 ml-2 ${
                      isActive
                        ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)] border-l-2 border-[var(--accent-cyan)]"
                        : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    } disabled:opacity-40 disabled:cursor-default`}
                    style={{ width: "calc(100% - 8px)" }}
                    title={entry.display ?? undefined}
                  >
                    {sessionLabel(entry)}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
