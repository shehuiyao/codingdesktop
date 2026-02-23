import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#9ece6a",
      },
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    const unlisten = listen<{ id: string; data: string }>("pty-output", (event) => {
      term.write(event.payload.data);
    });

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    return () => {
      unlisten.then((fn) => fn());
      observer.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-48 border-t border-[var(--border-color)]"
    />
  );
}
