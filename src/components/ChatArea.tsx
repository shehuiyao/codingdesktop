import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import MessageBubble from "./MessageBubble";

interface SessionMessage {
  role?: string;
  content?: unknown;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

function parseSessionMessages(raw: SessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of raw) {
    if (!msg.role || (msg.role !== "user" && msg.role !== "assistant")) continue;
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = (msg.content as { type?: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n");
    }
    if (text) {
      result.push({
        role: msg.role as "user" | "assistant",
        content: text,
        timestamp: Date.now(),
      });
    }
  }
  return result;
}

interface ChatAreaProps {
  sessionId: string | null;
  projectSlug: string | null;
}

export default function ChatArea({ sessionId, projectSlug }: ChatAreaProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectSlug || !sessionId) {
      setMessages([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    invoke<SessionMessage[]>("get_session", { projectSlug, sessionId })
      .then((data) => {
        if (!cancelled) setMessages(parseSessionMessages(data));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectSlug, sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[var(--text-secondary)]">Loading session...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[var(--accent-red)]">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {messages.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] text-sm py-4">
          No messages in this session
        </div>
      ) : (
        messages.map((msg, i) => (
          <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
