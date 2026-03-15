import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "@xterm/xterm/css/xterm.css";
import type { CliTool } from "./TabBar";

interface LiveTerminalProps {
  workingDir: string;
  yolo?: boolean;
  tool?: CliTool;
  resumeSessionId?: string;
  isActive?: boolean;
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

export default function LiveTerminal({ workingDir, yolo, tool, resumeSessionId, isActive = true, onSessionStarted, onError }: LiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const recordedSkillsRef = useRef<Set<string>>(new Set());
  const onSessionStartedRef = useRef(onSessionStarted);
  onSessionStartedRef.current = onSessionStarted;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);

  // 使用 Tauri 原生拖放事件处理文件拖入（只在当前活跃终端响应）
  useEffect(() => {
    const webview = getCurrentWebview();
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const dragUn = await webview.onDragDropEvent((event) => {
        // 只有当前活跃的终端才处理拖放事件
        if (!isActiveRef.current) return;

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

      // IME 输入处理：不使用 attachCustomKeyEventHandler（会干扰 Shift+标点），
      // 改为在 onData 层过滤组合期间的原始字母，防止切换输入法时重复输入。
      // compositionstart 先于 xterm 内部 handler 注册，确保状态在 onData 前更新。
      let imeComposing = false;
      const xtermTextarea = term.textarea;
      if (xtermTextarea) {
        const onCompStart = () => { imeComposing = true; };
        const onCompEnd = () => { imeComposing = false; };
        xtermTextarea.addEventListener('compositionstart', onCompStart);
        xtermTextarea.addEventListener('compositionend', onCompEnd);
        unlisteners.push(() => {
          xtermTextarea.removeEventListener('compositionstart', onCompStart);
          xtermTextarea.removeEventListener('compositionend', onCompEnd);
        });
      }

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
      let lastMeasuredWidth = 0;
      let lastMeasuredHeight = 0;
      let lastSentRows = 0;
      let lastSentCols = 0;

      // Register listeners BEFORE starting session
      // 缓冲 pty 输出，用 requestAnimationFrame 合并写入，防止高频输出导致 UI 卡死
      let outputBuffer = "";
      let outputFlushId: number | null = null;
      let skillCheckBuffer = "";
      let skillCheckTimer: ReturnType<typeof setTimeout> | null = null;

      const restoreViewport = (linesFromBottom: number) => {
        const newBaseY = term!.buffer.active.baseY;
        const targetY = Math.max(0, newBaseY - linesFromBottom);
        term!.scrollToLine(targetY);
      };

      const flushOutputBuffer = () => {
        if (outputBuffer && term) {
          // 写入前记住滚动位置，大量输出可能触发 scrollback 裁剪导致跳顶
          const buf = term.buffer.active;
          const wasAtBottom = buf.viewportY >= buf.baseY;
          const linesFromBottom = buf.baseY - buf.viewportY;
          const pendingOutput = outputBuffer;
          outputBuffer = "";

          // xterm.write 是异步写入，必须在回调里恢复 viewport 才能读到新 buffer 状态
          term.write(pendingOutput, () => {
            if (wasAtBottom) {
              term!.scrollToBottom();
            } else {
              restoreViewport(linesFromBottom);
            }
          });
        }
        outputFlushId = null;
      };

      const checkSkills = () => {
        if (skillCheckBuffer) {
          const clean = skillCheckBuffer.replace(/\x1b\[[\d;]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
          const matches = clean.matchAll(/Skill\(([^)]+)\)/g);
          for (const m of matches) {
            if (/^[\w\-:.]+$/.test(m[1]) && !recordedSkillsRef.current.has(m[1])) {
              recordedSkillsRef.current.add(m[1]);
              invoke("record_skill_usage", { skillName: m[1] }).catch(() => {});
            }
          }
          skillCheckBuffer = "";
        }
        skillCheckTimer = null;
      };

      const outputUn = await listen<{ id: string; data: string }>("pty-output", (event) => {
        if (event.payload.id === sessionId) {
          hasReceivedOutput = true;
          outputBuffer += event.payload.data;
          if (outputFlushId === null) {
            outputFlushId = requestAnimationFrame(flushOutputBuffer);
          }
          // 延迟批量检测技能调用，避免每条输出都跑正则
          skillCheckBuffer += event.payload.data;
          if (!skillCheckTimer) {
            skillCheckTimer = setTimeout(checkSkills, 500);
          }
        }
      });
      unlisteners.push(outputUn);
      unlisteners.push(() => {
        if (outputFlushId !== null) cancelAnimationFrame(outputFlushId);
        if (skillCheckTimer) clearTimeout(skillCheckTimer);
      });

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
        const id = await invoke<string>("start_session", { workingDir, yolo: yolo ?? false, tool: tool ?? "claude", resumeSessionId: resumeSessionId ?? null });
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
        lastSentRows = rows;
        lastSentCols = cols;

        const dataDisposable = term.onData((data) => {
          // IME 组合期间不发送原始按键，防止切换输入法时重复输入
          // compositionend 后 imeComposing=false，最终文字正常发送
          if (imeComposing) return;
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
      let ptyResizeTimer: ReturnType<typeof setTimeout> | null = null;
      let wasHidden = true;
      observer = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const el = containerRef.current;
          if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) {
            wasHidden = true;
            return;
          }
          const nextWidth = el.offsetWidth;
          const nextHeight = el.offsetHeight;
          const sizeChanged = nextWidth !== lastMeasuredWidth || nextHeight !== lastMeasuredHeight;
          if (!sizeChanged && !wasHidden) {
            return;
          }
          lastMeasuredWidth = nextWidth;
          lastMeasuredHeight = nextHeight;
          // 记住滚动位置，fit() 后恢复，防止跳到顶部
          const buf = term!.buffer.active;
          const wasAtBottom = buf.viewportY >= buf.baseY;
          const linesFromBottom = buf.baseY - buf.viewportY;
          fitAddon!.fit();
          if (wasAtBottom) {
            term!.scrollToBottom();
          } else {
            // 用户往上翻了，保持与底部的距离不变
            restoreViewport(linesFromBottom);
          }
          if (sessionIdRef.current) {
            const cols = term!.cols;
            const rows = term!.rows;
            const terminalSizeChanged = rows !== lastSentRows || cols !== lastSentCols;
            if (terminalSizeChanged) {
              if (ptyResizeTimer) clearTimeout(ptyResizeTimer);
              ptyResizeTimer = setTimeout(() => {
                if (!sessionIdRef.current) return;
                if (rows === lastSentRows && cols === lastSentCols) return;
                invoke("resize_session", { sessionId: sessionIdRef.current, rows, cols }).catch(() => {});
                lastSentRows = rows;
                lastSentCols = cols;
                ptyResizeTimer = null;
              }, 120);
            }
          }
          // 从隐藏变为可见时自动聚焦终端（tab 切换场景）
          // 使用 preventScroll 防止浏览器聚焦 textarea 时触发滚动跳转
          if (wasHidden) {
            term!.textarea?.focus({ preventScroll: true });
          }
          wasHidden = false;
        }, 50);
      });
      observer.observe(containerRef.current!);
      unlisteners.push(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        if (ptyResizeTimer) clearTimeout(ptyResizeTimer);
      });
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
  }, [workingDir, yolo, tool, resumeSessionId]);

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
          Starting {{ claude: "Claude", gemini: "Gemini", codex: "Codex" }[tool ?? "claude"]} session...
        </div>
      )}
      <div className="flex-1 min-h-0 p-2">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
