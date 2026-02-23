import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | { type: string; text: string }[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: ContentBlock[];
  timestamp: number;
}

interface ChatViewProps {
  workingDir: string;
  onSwitchToTerminal: () => void;
}

export default function ChatView({ workingDir, onSwitchToTerminal }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [debugOutput, setDebugOutput] = useState<string | null>(null);
  const chatIdRef = useRef(`chat-${Date.now()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentAssistantRef = useRef<ContentBlock[]>([]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Listen for chat events
  useEffect(() => {
    const chatId = chatIdRef.current;

    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const streamUn = await listen<{ chatId: string; data: Record<string, unknown> }>(
        "chat-stream",
        (event) => {
          if (event.payload.chatId !== chatId) return;
          const data = event.payload.data;
          const type = data.type as string;

          if (type === "system") {
            // Extract session ID for resume
            if (data.session_id) {
              setSessionId(data.session_id as string);
            }
          } else if (type === "assistant") {
            // Assistant message snapshot - update current streaming message
            const msg = data.message as Record<string, unknown> | undefined;
            if (msg?.content) {
              const content = msg.content as ContentBlock[];
              currentAssistantRef.current = content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.role === "assistant" && last.id === "streaming") {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: [...content] },
                  ];
                }
                return [
                  ...prev,
                  {
                    id: "streaming",
                    role: "assistant",
                    content: [...content],
                    timestamp: Date.now(),
                  },
                ];
              });
            }
          } else if (type === "result") {
            // Final result - finalize the message
            if (data.session_id) {
              setSessionId(data.session_id as string);
            }
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.id === "streaming") {
                return [
                  ...prev.slice(0, -1),
                  { ...last, id: `msg-${Date.now()}` },
                ];
              }
              return prev;
            });
          }
        }
      );
      unlisteners.push(streamUn);

      const doneUn = await listen<{ chatId: string }>("chat-done", (event) => {
        if (event.payload.chatId !== chatId) return;
        setLoading(false);
        // Finalize any streaming message
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === "streaming") {
            return [
              ...prev.slice(0, -1),
              { ...last, id: `msg-${Date.now()}` },
            ];
          }
          return prev;
        });
      });
      unlisteners.push(doneUn);

      const errorUn = await listen<{ chatId: string; error: string }>(
        "chat-error",
        (event) => {
          if (event.payload.chatId !== chatId) return;
          const errMsg = event.payload.error;
          console.error("Chat error:", errMsg);
          // Show error in chat as a system message
          setMessages((prev) => {
            // Avoid duplicate error messages
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.id.startsWith("error-")) {
              // Append to existing error
              const lastText = last.content[0]?.text || "";
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  content: [{ type: "text", text: lastText + "\n" + errMsg }],
                },
              ];
            }
            return [
              ...prev,
              {
                id: `error-${Date.now()}`,
                role: "assistant" as const,
                content: [{ type: "text", text: `Error: ${errMsg}` }],
                timestamp: Date.now(),
              },
            ];
          });
          setLoading(false);
        }
      );
      unlisteners.push(errorUn);
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
      // Clean up the chat process
      invoke("chat_stop", { chatId }).catch(() => {});
    };
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    currentAssistantRef.current = [];

    try {
      await invoke("chat_send", {
        chatId: chatIdRef.current,
        message: text,
        workingDir,
        resumeSessionId: sessionId,
      });
    } catch (e) {
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: [{ type: "text", text: `Error: ${e}` }],
          timestamp: Date.now(),
        },
      ]);
    }
  }, [input, loading, workingDir, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleBlock = (blockId: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  const renderContentBlock = (block: ContentBlock, index: number, msgId: string) => {
    const blockKey = `${msgId}-${index}`;

    if (block.type === "thinking") {
      const isExpanded = expandedBlocks.has(blockKey);
      return (
        <div key={blockKey} className="mb-2">
          <button
            onClick={() => toggleBlock(blockKey)}
            className="flex items-center gap-1.5 text-[11px] text-[var(--accent-purple)] hover:text-[var(--accent-purple)]/80 cursor-pointer transition-colors"
          >
            <span className="text-[9px]">{isExpanded ? "▼" : "▶"}</span>
            <span>Thinking...</span>
          </button>
          {isExpanded && (
            <div className="mt-1 ml-3 pl-3 border-l-2 border-[var(--accent-purple)]/30 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap max-h-60 overflow-y-auto">
              {block.thinking}
            </div>
          )}
        </div>
      );
    }

    if (block.type === "tool_use") {
      const isExpanded = expandedBlocks.has(blockKey);
      const toolLabel = formatToolLabel(block.name || "tool", block.input);
      return (
        <div key={blockKey} className="mb-2">
          <button
            onClick={() => toggleBlock(blockKey)}
            className="flex items-center gap-1.5 w-full text-left px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:border-[var(--border-subtle)] cursor-pointer transition-colors"
          >
            <span className="text-[9px] text-[var(--text-muted)]">{isExpanded ? "▼" : "▶"}</span>
            <span className="text-[11px] text-[var(--accent-orange)]">{block.name}</span>
            <span className="text-[11px] text-[var(--text-secondary)] truncate">{toolLabel}</span>
          </button>
          {isExpanded && block.input && (
            <div className="mt-1 ml-3 pl-3 border-l-2 border-[var(--accent-orange)]/30">
              <pre className="text-[10px] text-[var(--text-secondary)] whitespace-pre-wrap overflow-x-auto">
                {JSON.stringify(block.input, null, 2)}
              </pre>
            </div>
          )}
        </div>
      );
    }

    if (block.type === "tool_result") {
      const isExpanded = expandedBlocks.has(blockKey);
      const resultText = typeof block.content === "string"
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((c) => c.text || "").join("")
          : "";
      const preview = resultText.slice(0, 80) + (resultText.length > 80 ? "..." : "");
      return (
        <div key={blockKey} className="mb-2">
          <button
            onClick={() => toggleBlock(blockKey)}
            className="flex items-center gap-1.5 text-[11px] text-[var(--accent-green)] hover:text-[var(--accent-green)]/80 cursor-pointer transition-colors"
          >
            <span className="text-[9px]">{isExpanded ? "▼" : "▶"}</span>
            <span>Result: {preview}</span>
          </button>
          {isExpanded && (
            <div className="mt-1 ml-3 pl-3 border-l-2 border-[var(--accent-green)]/30 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap max-h-60 overflow-y-auto">
              {resultText}
            </div>
          )}
        </div>
      );
    }

    if (block.type === "text" && block.text) {
      return (
        <div key={blockKey} className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Chat header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">Chat Mode</span>
          {sessionId && (
            <span className="text-[10px] text-[var(--text-muted)]">
              session: {sessionId.slice(0, 8)}...
            </span>
          )}
        </div>
        <button
          onClick={onSwitchToTerminal}
          className="px-2 py-1 text-[10px] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150"
        >
          Switch to Terminal
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-sm text-[var(--text-secondary)] mb-1">Start a conversation</div>
              <div className="text-[11px] text-[var(--text-muted)] mb-4">
                Type a message below to chat with Claude
              </div>
              <button
                onClick={async () => {
                  setDebugOutput("Testing...");
                  try {
                    const result = await invoke<string>("chat_test", { workingDir });
                    setDebugOutput(result);
                  } catch (e) {
                    setDebugOutput(`Error: ${e}`);
                  }
                }}
                className="text-[10px] text-[var(--text-muted)] underline cursor-pointer hover:text-[var(--text-secondary)]"
              >
                Run diagnostic test
              </button>
              {debugOutput && (
                <pre className="mt-3 text-left text-[10px] text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-lg p-3 max-h-60 overflow-auto whitespace-pre-wrap">
                  {debugOutput}
                </pre>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-3 ${
                msg.role === "user"
                  ? "bg-[var(--accent-cyan)]/15 border border-[var(--accent-cyan)]/20"
                  : "bg-[var(--bg-secondary)] border border-[var(--border-subtle)]"
              }`}
            >
              {msg.content.map((block, i) => renderContentBlock(block, i, msg.id))}
            </div>
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse" style={{ animationDelay: "0.2s" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse" style={{ animationDelay: "0.4s" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message... (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-cyan)] transition-colors duration-150 resize-none max-h-32 overflow-y-auto"
            style={{ minHeight: "40px" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="px-4 py-2.5 text-sm font-medium bg-[var(--accent-cyan)] text-[#0d1117] rounded-lg hover:brightness-110 active:brightness-90 transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function formatToolLabel(name: string, input?: Record<string, unknown>): string {
  if (!input) return "";
  switch (name) {
    case "Read":
      return input.file_path ? ` ${(input.file_path as string).split("/").pop()}` : "";
    case "Edit":
      return input.file_path ? ` ${(input.file_path as string).split("/").pop()}` : "";
    case "Write":
      return input.file_path ? ` ${(input.file_path as string).split("/").pop()}` : "";
    case "Bash":
      return input.command ? ` ${(input.command as string).slice(0, 40)}` : "";
    case "Glob":
      return input.pattern ? ` ${input.pattern}` : "";
    case "Grep":
      return input.pattern ? ` ${input.pattern}` : "";
    default:
      return "";
  }
}
