interface ChatAreaProps {
  sessionId: string | null;
  projectSlug: string | null;
  onToggleSidebar: () => void;
}

export default function ChatArea({ sessionId: _sessionId, projectSlug: _projectSlug, onToggleSidebar }: ChatAreaProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <button
          onClick={onToggleSidebar}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
        >
          [=]
        </button>
        <span className="text-xs text-[var(--text-secondary)]">no session</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-[var(--text-secondary)]">
          <div className="text-lg mb-2">Claude Code Desktop</div>
          <div className="text-sm">Start a new session to begin</div>
        </div>
      </div>
      <div className="border-t border-[var(--border-color)] p-3 bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          <span className="text-[var(--accent-green)]">&#10095;</span>
          <input
            type="text"
            placeholder="Type a message..."
            disabled
            className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)]"
          />
        </div>
      </div>
    </div>
  );
}
