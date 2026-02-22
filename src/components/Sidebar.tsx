interface SidebarProps {
  activeSessionId: string | null;
  onSelectSession: (projectSlug: string, sessionId: string) => void;
  onNewSession: () => void;
}

export default function Sidebar({ activeSessionId: _activeSessionId, onSelectSession: _onSelectSession, onNewSession }: SidebarProps) {
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
        <div className="text-xs text-[var(--text-secondary)] p-2">No sessions yet</div>
      </div>
    </div>
  );
}
