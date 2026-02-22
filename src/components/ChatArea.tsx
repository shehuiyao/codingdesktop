import { useEffect, useRef } from "react";
import { useSession } from "../hooks/useSession";
import { open } from "@tauri-apps/plugin-dialog";
import MessageBubble from "./MessageBubble";
import InputBar from "./InputBar";

interface ChatAreaProps {
  sessionId: string | null;
  projectSlug: string | null;
  onToggleSidebar: () => void;
}

function DirectoryPicker({ onStart }: { onStart: (dir: string) => void }) {
  const handlePickFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select project directory",
    });
    if (selected && typeof selected === "string") {
      onStart(selected);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center text-[var(--text-secondary)] max-w-sm w-full px-4">
        <div className="text-lg mb-2 text-[var(--text-primary)]">
          Claude Code Desktop
        </div>
        <div className="text-sm mb-6">
          Select a project folder to start a new session
        </div>
        <button
          onClick={handlePickFolder}
          className="w-full py-3 px-4 text-sm bg-[var(--accent-blue)] text-white rounded hover:opacity-90 transition-opacity cursor-pointer"
        >
          Choose Folder...
        </button>
      </div>
    </div>
  );
}

export default function ChatArea({ sessionId, projectSlug, onToggleSidebar }: ChatAreaProps) {
  const { messages, loading, error, isLive, workingDir, startLiveSession, sendMessage } =
    useSession(projectSlug, sessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasSession = sessionId !== null || isLive;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const headerLabel = isLive
    ? workingDir || "live session"
    : sessionId
      ? `session: ${sessionId.slice(0, 8)}...`
      : "no session";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <button
          onClick={onToggleSidebar}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
        >
          [=]
        </button>
        <span className="text-xs text-[var(--text-secondary)] truncate">
          {headerLabel}
        </span>
        {isLive && (
          <span className="ml-auto text-xs text-[var(--accent-green)]">live</span>
        )}
      </div>

      {/* Content area */}
      {!hasSession ? (
        <DirectoryPicker onStart={startLiveSession} />
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-[var(--text-secondary)]">Loading session...</span>
        </div>
      ) : error && messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-[var(--accent-red)]">{error}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {!loading && messages.length === 0 && !error && (
            <div className="text-center text-[var(--text-secondary)] text-sm py-4">
              {isLive ? "Session started. Waiting for output..." : "No messages in this session"}
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input bar */}
      <InputBar disabled={!isLive} onSend={sendMessage} />
    </div>
  );
}
