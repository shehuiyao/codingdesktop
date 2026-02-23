import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface LiveTerminalProps {
  workingDir: string;
  yolo?: boolean;
  onSessionStarted?: (id: string) => void;
}

// Use system monospace fonts — same as --font-mono in global.css
const TERM_FONT = "ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Mono', Consolas, 'Liberation Mono', 'Courier New', monospace";

export default function LiveTerminal({ workingDir, yolo, onSessionStarted }: LiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

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

      term = new XTerm({
        theme: {
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
        },
        fontSize: 13,
        fontFamily: TERM_FONT,
        cursorBlink: true,
        scrollback: 5000,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current!);
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Register listeners BEFORE starting session
      const outputUn = await listen<{ id: string; data: string }>("pty-output", (event) => {
        if (event.payload.id === sessionId) {
          term!.write(event.payload.data);
        }
      });
      unlisteners.push(outputUn);

      const exitUn = await listen<{ id: string }>("pty-exit", (event) => {
        if (event.payload.id === sessionId) {
          term!.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
        }
      });
      unlisteners.push(exitUn);

      // Start PTY session
      try {
        const id = await invoke<string>("start_session", { workingDir, yolo: yolo ?? false });
        sessionId = id;
        sessionIdRef.current = id;
        setStarting(false);

        if (unmounted) {
          invoke("close_session", { sessionId: id }).catch(() => {});
          return;
        }

        if (onSessionStarted) onSessionStarted(id);

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

      // Handle resize
      observer = new ResizeObserver(() => {
        fitAddon!.fit();
        if (sessionIdRef.current) {
          const cols = term!.cols;
          const rows = term!.rows;
          invoke("resize_session", { sessionId: sessionIdRef.current, rows, cols }).catch(() => {});
        }
      });
      observer.observe(containerRef.current!);
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
  }, [workingDir, yolo, onSessionStarted]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[var(--accent-red)]">{error}</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {starting && (
        <div className="px-3 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
          Starting Claude session...
        </div>
      )}
      <div className="flex-1 min-h-0 p-2">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
