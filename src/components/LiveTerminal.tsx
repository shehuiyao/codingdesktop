import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "@xterm/xterm/css/xterm.css";

type CliTool = "claude" | "gemini";

interface LiveTerminalProps {
  workingDir: string;
  yolo?: boolean;
  tool?: CliTool;
  onSessionStarted?: (id: string) => void;
  onError?: (error: string) => void;
}

const TERM_FONT = "'JetBrains Mono NF', 'SF Mono', Menlo, Monaco, monospace";

function getTerminalTheme(isDark: boolean) {
  if (isDark) {
    return {
      background: "#0d1117",
      foreground: "#e6edf3",
      cursor: "#39d2c0",
      black: "#161b22",
      red: "#f85149",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#58a6ff",
      magenta: "#bc8cff",
      cyan: "#39d2c0",
      white: "#8b949e",
      brightBlack: "#484f58",
      brightRed: "#ff7b72",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d4c4",
      brightWhite: "#f0f6fc",
    };
  }
  return {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#0598a1",
    black: "#1f2328",
    red: "#cf222e",
    green: "#1a7f37",
    yellow: "#9a6700",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#0598a1",
    white: "#6e7781",
    brightBlack: "#8b949e",
    brightRed: "#a40e26",
    brightGreen: "#2da44e",
    brightYellow: "#bf8700",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#1f2328",
  };
}

export default function LiveTerminal({ workingDir, yolo, tool, onSessionStarted, onError }: LiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onSessionStartedRef = useRef(onSessionStarted);
  onSessionStartedRef.current = onSessionStarted;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);

  // 使用 Tauri 原生拖放事件处理文件拖入（支持所有文件类型）
  useEffect(() => {
    const webview = getCurrentWebview();
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const dragUn = await webview.onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragOver(true);
        } else if (event.payload.type === "leave") {
          setIsDragOver(false);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const filePaths = event.payload.paths;
          if (filePaths.length > 0 && sessionIdRef.current) {
            const quoted = filePaths.map((p: string) =>
              p.includes(" ") ? `"${p}"` : p
            );
            invoke("send_input", {
              sessionId: sessionIdRef.current,
              data: quoted.join(" "),
            }).catch(() => {});
          }
        }
      });
      unlisteners.push(dragUn);
    };

    setup();
    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let unmounted = false;
    let sessionId: string | null = null;
    const unlisteners: (() => void)[] = [];
    let term: XTerm | null = null;
    let fitAddon: FitAddon | null = null;
    let observer: ResizeObserver | null = null;

    const setup = async () => {
      if (unmounted || !containerRef.current) return;

      const currentTheme = document.documentElement.getAttribute("data-theme");
      const isDark = currentTheme !== "light";

      term = new XTerm({
        theme: getTerminalTheme(isDark),
        fontSize: 13,
        fontFamily: TERM_FONT,
        customGlyphs: false,
        drawBoldTextInBrightColors: false,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // Load Unicode11 for correct CJK character widths
      try {
        const unicode11 = new Unicode11Addon();
        term.loadAddon(unicode11);
      } catch {
        // fallback to default unicode handling
      }

      term.open(containerRef.current!);

      // Set activeVersion AFTER open()
      try {
        term.unicode.activeVersion = "11";
      } catch {
        // ignore
      }

      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Track whether any output has been received (for frontend timeout warning)
      let hasReceivedOutput = false;

      // Register listeners BEFORE starting session
      const outputUn = await listen<{ id: string; data: string }>("pty-output", (event) => {
        if (event.payload.id === sessionId) {
          hasReceivedOutput = true;
          term!.write(event.payload.data);
          // 检测技能调用，记录使用次数（格式: Skill(skill-name)）
          const clean = event.payload.data.replace(/\x1b\[[\d;]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
          const m = clean.match(/Skill\(([^)]+)\)/);
          if (m && /^[\w\-:.]+$/.test(m[1])) {
            invoke("record_skill_usage", { skillName: m[1] }).catch(() => {});
          }
        }
      });
      unlisteners.push(outputUn);

      const exitUn = await listen<{ id: string }>("pty-exit", (event) => {
        if (event.payload.id === sessionId) {
          term!.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
        }
      });
      unlisteners.push(exitUn);

      // Listen for pty-error events (backend timeout or read errors)
      const errorUn = await listen<{ id: string; error: string }>("pty-error", (event) => {
        if (event.payload.id === sessionId) {
          term!.write(`\r\n\x1b[31m[Error] ${event.payload.error}\x1b[0m\r\n`);
          if (onErrorRef.current) onErrorRef.current(event.payload.error);
        }
      });
      unlisteners.push(errorUn);

      // Start PTY session
      try {
        const id = await invoke<string>("start_session", { workingDir, yolo: yolo ?? false, tool: tool ?? "claude" });
        sessionId = id;
        sessionIdRef.current = id;
        setStarting(false);

        if (unmounted) {
          invoke("close_session", { sessionId: id }).catch(() => {});
          return;
        }

        if (onSessionStartedRef.current) onSessionStartedRef.current(id);

        // Frontend startup timeout: warn after 15 seconds if no output received
        const startupTimeout = setTimeout(() => {
          if (!hasReceivedOutput && !unmounted) {
            term!.write("\r\n\x1b[33m[Warning] No output received after 15 seconds. The session may be starting slowly or stuck.\x1b[0m\r\n");
            if (onErrorRef.current) onErrorRef.current("Startup timeout: no output received after 15 seconds");
          }
        }, 15_000);
        unlisteners.push(() => clearTimeout(startupTimeout));

        const cols = term.cols;
        const rows = term.rows;
        await invoke("resize_session", { sessionId: id, rows, cols });

        const dataDisposable = term.onData((data) => {
          if (sessionIdRef.current) {
            invoke("send_input", { sessionId: sessionIdRef.current, data }).catch(() => {});
          }
        });
        unlisteners.push(() => dataDisposable.dispose());
      } catch (e) {
        setError(String(e));
        setStarting(false);
        term.write(`\x1b[31mError: ${e}\x1b[0m\r\n`);
      }

      // Listen for theme changes and update terminal colors
      const themeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes" && mutation.attributeName === "data-theme") {
            const newTheme = document.documentElement.getAttribute("data-theme");
            const newIsDark = newTheme !== "light";
            term!.options.theme = getTerminalTheme(newIsDark);
          }
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      unlisteners.push(() => themeObserver.disconnect());

      // Handle resize — debounce to avoid fitting with stale dimensions during tab switch
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      let wasHidden = true;
      observer = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const el = containerRef.current;
          if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) {
            wasHidden = true;
            return;
          }
          fitAddon!.fit();
          if (sessionIdRef.current) {
            const cols = term!.cols;
            const rows = term!.rows;
            invoke("resize_session", { sessionId: sessionIdRef.current, rows, cols }).catch(() => {});
          }
          // 从隐藏变为可见时自动聚焦终端（tab 切换场景）
          if (wasHidden) {
            term!.focus();
          }
          wasHidden = false;
        }, 50);
      });
      observer.observe(containerRef.current!);
      unlisteners.push(() => { if (resizeTimer) clearTimeout(resizeTimer); });
    };

    setup();

    return () => {
      unmounted = true;
      observer?.disconnect();
      unlisteners.forEach((fn) => fn());
      if (sessionIdRef.current) {
        invoke("close_session", { sessionId: sessionIdRef.current }).catch(() => {});
        sessionIdRef.current = null;
      }
      term?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onSessionStarted is tracked via ref
  }, [workingDir, yolo, tool]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[var(--accent-red)]">{error}</span>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col overflow-hidden relative"
    >
      {/* Drop zone overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)]/80 border-2 border-dashed border-[var(--accent-cyan)] rounded-lg pointer-events-none">
          <div className="text-sm text-[var(--accent-cyan)]">
            Drop files to paste path
          </div>
        </div>
      )}
      {starting && (
        <div className="px-3 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
          Starting {tool === "gemini" ? "Gemini" : "Claude"} session...
        </div>
      )}
      <div className="flex-1 min-h-0 p-2">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
