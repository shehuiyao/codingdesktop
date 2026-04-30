import { useState, useCallback, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import LiveTerminal from "./components/LiveTerminal";
import StatusBar from "./components/StatusBar";
import FileTree from "./components/FileTree";
import SkillsPanel from "./components/SkillsPanel";
import BranchSwitcher from "./components/BranchSwitcher";
import CommitHistory from "./components/CommitHistory";
import BugTrackerPanel from "./components/BugTrackerPanel";
import QuickActionsPanel from "./components/QuickActionsPanel";
import TabBar, { type Tab, type CliTool, type CodexPermissionMode } from "./components/TabBar";
import SplitDivider from "./components/SplitDivider";
import LaunchpadPanel from "./components/LaunchpadPanel";
import CodexUsagePanel from "./components/CodexUsagePanel";

interface GitInfo {
  branch: string;
  additions: number;
  deletions: number;
}

type CodexTool = Extract<CliTool, "codex" | "codex_sub">;

const CODEX_PERMISSION_KEY = "coding-desktop-codex-permission-modes";
const LEGACY_CODEX_PERMISSION_KEY = "claude-desktop-codex-permission-modes";
const DEFAULT_CODEX_PERMISSION_MODES: Record<CodexTool, CodexPermissionMode> = {
  codex_sub: "full_access",
  codex: "full_access",
};

const CODEX_PERMISSION_OPTIONS: { value: CodexPermissionMode; label: string }[] = [
  { value: "default", label: "默认权限" },
  { value: "auto_review", label: "自动审查" },
  { value: "full_access", label: "完全访问权限" },
];

function loadCodexPermissionModes(): Record<CodexTool, CodexPermissionMode> {
  try {
    const current = localStorage.getItem(CODEX_PERMISSION_KEY);
    const legacy = localStorage.getItem(LEGACY_CODEX_PERMISSION_KEY);
    if (!current && legacy) {
      localStorage.setItem(CODEX_PERMISSION_KEY, legacy);
    }
    const raw = current ?? legacy;
    if (!raw) return DEFAULT_CODEX_PERMISSION_MODES;
    const parsed = JSON.parse(raw) as Partial<Record<CodexTool, CodexPermissionMode>>;
    return {
      codex_sub: parsed.codex_sub ?? DEFAULT_CODEX_PERMISSION_MODES.codex_sub,
      codex: parsed.codex ?? DEFAULT_CODEX_PERMISSION_MODES.codex,
    };
  } catch {
    return DEFAULT_CODEX_PERMISSION_MODES;
  }
}

function normalizeCliTool(tool: string | null | undefined): CliTool {
  if (tool === "gemini" || tool === "codex" || tool === "codex_sub" || tool === "volc") {
    return tool;
  }
  return "claude";
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showFileTree, setShowFileTree] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const [showBugTracker, setShowBugTracker] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [workingDir, setWorkingDir] = useState<string | null>(null);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [tabToClose, setTabToClose] = useState<string | null>(null);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showLaunchpad, setShowLaunchpad] = useState(false);
  const [showCodexUsage, setShowCodexUsage] = useState(false);
  const [moreModePickerTabId, setMoreModePickerTabId] = useState<string | null>(null);
  const [codexPermissionModes, setCodexPermissionModes] = useState<Record<CodexTool, CodexPermissionMode>>(loadCodexPermissionModes);
  // Track tabs that have had terminal mode activated (for lazy mounting)
  const [terminalActivated, setTerminalActivated] = useState<Set<string>>(new Set());
  // Map sessionId -> tabId for correlating pty events to tabs
  const sessionTabMap = useRef<Map<string, string>>(new Map());
  // Keep the latest tabs snapshot for event listeners without re-subscribing
  const tabsRef = useRef<Tab[]>(tabs);
  tabsRef.current = tabs;
  // Track which tabs have already transitioned from idle, to avoid re-renders on every pty-output
  const activatedTabsRef = useRef<Set<string>>(new Set());
  // Track which tabs are in waiting state
  const waitingTabsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem(CODEX_PERMISSION_KEY, JSON.stringify(codexPermissionModes));
  }, [codexPermissionModes]);

  // 分屏状态
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  // TabBar 拖拽状态
  const [tabDragging, setTabDragging] = useState(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [showDropZone, setShowDropZone] = useState(false);

  const handleNewTab = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select project directory",
    });
    if (selected && typeof selected === "string") {
      const tabId = `tab-${Date.now()}`;
      const dirName = selected.split("/").pop() || selected;
      setTabs((prev) => [
        ...prev,
        { id: tabId, label: dirName, workingDir: selected, mode: "terminal", status: "idle" },
      ]);
      // Don't activate terminal yet - let user pick mode first
      setActiveTabId(tabId);
      setWorkingDir(selected);
      setActiveSessionId(null);
      setActiveProject(null);
      setShowLaunchpad(false);
      setShowCodexUsage(false);
    }
  }, []);

  const doCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const newActive = remaining.length > 0 ? remaining[remaining.length - 1] : null;
          setActiveTabId(newActive?.id ?? null);
          setWorkingDir(newActive?.workingDir ?? null);
        }
        return remaining;
      });
      // 关闭的 tab 正好是分屏 tab 时，退出分屏
      if (tabId === splitTabId) {
        setSplitTabId(null);
        setSplitRatio(0.5);
      }
      setTerminalActivated((prev) => {
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
      waitingTabsRef.current.delete(tabId);
      activatedTabsRef.current.delete(tabId);
      // Clean up session-to-tab mappings for this tab
      for (const [sessionId, mappedTabId] of sessionTabMap.current.entries()) {
        if (mappedTabId === tabId) {
          sessionTabMap.current.delete(sessionId);
        }
      }
    },
    [activeTabId, splitTabId],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabToClose(tabId);
    },
    [],
  );

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setActiveSessionId(null);
    setActiveProject(null);
    setShowLaunchpad(false);
    setShowCodexUsage(false);
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (tab) setWorkingDir(tab.workingDir);
      return prev;
    });
  }, []);

  const handleStartTerminal = useCallback((tabId: string, yolo: boolean, tool: CliTool = "claude", permissionMode?: CodexPermissionMode) => {
    setMoreModePickerTabId(null);
    setTerminalActivated((prev) => new Set(prev).add(tabId));
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, mode: "terminal" as const, yolo, tool, permissionMode, status: "running" as const } : t))
    );
  }, []);

  const handleStartCodexTerminal = useCallback(
    (tabId: string, tool: CodexTool) => {
      const permissionMode = codexPermissionModes[tool];
      handleStartTerminal(tabId, permissionMode === "full_access", tool, permissionMode);
    },
    [codexPermissionModes, handleStartTerminal],
  );

  const handleCodexPermissionChange = useCallback((tool: CodexTool, permissionMode: CodexPermissionMode) => {
    setCodexPermissionModes((prev) => ({ ...prev, [tool]: permissionMode }));
  }, []);

  const handleReorderTabs = useCallback((reordered: Tab[]) => {
    setTabs(reordered);
  }, []);

  const handleTabDragStateChange = useCallback((dragging: boolean, tabId: string | null) => {
    setTabDragging(dragging);
    setDraggingTabId(tabId);
    if (!dragging) setShowDropZone(false);
  }, []);

  const handleContentPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!tabDragging) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const isRightHalf = e.clientX > rect.left + rect.width / 2;
      setShowDropZone(isRightHalf);
    },
    [tabDragging],
  );

  const handleContentPointerUp = useCallback(() => {
    if (tabDragging && showDropZone && draggingTabId && draggingTabId !== activeTabId) {
      setSplitTabId(draggingTabId);
    }
    setShowDropZone(false);
  }, [tabDragging, showDropZone, draggingTabId, activeTabId]);

  const handleCloseSplit = useCallback(() => {
    setSplitTabId(null);
    setSplitRatio(0.5);
  }, []);

  // Update a specific tab's status
  const updateTabStatus = useCallback((tabId: string, status: Tab["status"]) => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        if (t.id !== tabId || t.status === status) return t;
        changed = true;
        return { ...t, status };
      });
      return changed ? next : prev;
    });
  }, []);

  // Called when a LiveTerminal session starts - maps sessionId to tabId
  const handleSessionStarted = useCallback((tabId: string, sessionId: string) => {
    sessionTabMap.current.set(sessionId, tabId);
  }, []);

  // Listen for pty-output and pty-exit events to update tab status
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setupListeners = async () => {
      const outputUn = await listen<{ id: string; data: string }>("pty-output", (event) => {
        const tabId = sessionTabMap.current.get(event.payload.id);
        if (!tabId) return;

        if (!activatedTabsRef.current.has(tabId)) {
          activatedTabsRef.current.add(tabId);
          updateTabStatus(tabId, "running");
        }
      });
      unlisteners.push(outputUn);

      const confirmUn = await listen<{ id: string; waiting: boolean }>("pty-awaiting-confirmation", (event) => {
        const tabId = sessionTabMap.current.get(event.payload.id);
        if (!tabId) return;

        if (event.payload.waiting) {
          waitingTabsRef.current.add(tabId);
          updateTabStatus(tabId, "waiting");
          return;
        }

        waitingTabsRef.current.delete(tabId);
        const current = tabsRef.current.find((t) => t.id === tabId);
        if (!current || current.status === "done" || current.status === "error") return;
        updateTabStatus(tabId, "running");
      });
      unlisteners.push(confirmUn);

      const exitUn = await listen<{ id: string; code?: number }>("pty-exit", (event) => {
        const tabId = sessionTabMap.current.get(event.payload.id);
        if (tabId) {
          updateTabStatus(tabId, "done");
          activatedTabsRef.current.delete(tabId);
          waitingTabsRef.current.delete(tabId);
          sessionTabMap.current.delete(event.payload.id);
        }
      });
      unlisteners.push(exitUn);

      // Listen for pty-error events to mark tab as errored
      const errorUn = await listen<{ id: string; error: string }>("pty-error", (event) => {
        const tabId = sessionTabMap.current.get(event.payload.id);
        if (tabId) {
          updateTabStatus(tabId, "error");
          waitingTabsRef.current.delete(tabId);
        }
      });
      unlisteners.push(errorUn);
    };

    setupListeners();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [updateTabStatus]);

  const handleSelectHistorySession = useCallback(
    (projectSlug: string, sessionId: string) => {
      setActiveProject(projectSlug);
      setActiveSessionId(sessionId);
      setActiveTabId(null);
      setShowLaunchpad(false);
      setShowCodexUsage(false);
    },
    [],
  );

  const handleOpenProject = useCallback((projectPath: string) => {
    const tabId = `tab-${Date.now()}`;
    const dirName = projectPath.split("/").pop() || projectPath;
    setTabs((prev) => [
      ...prev,
      { id: tabId, label: dirName, workingDir: projectPath, mode: "terminal", status: "idle" },
    ]);
    // Don't activate terminal yet - let user pick mode first
    setActiveTabId(tabId);
    setWorkingDir(projectPath);
    setActiveSessionId(null);
    setActiveProject(null);
    setShowLaunchpad(false);
    setShowCodexUsage(false);
  }, []);

  // 从历史记录恢复对话：先创建待选择启动方式的 tab，真正启动时再带上 --resume 参数
  const handleResumeSession = useCallback((projectPath: string, sessionId: string, tool?: string | null) => {
    const tabId = `tab-${Date.now()}`;
    const dirName = projectPath.split("/").pop() || projectPath;
    const cliTool = normalizeCliTool(tool);
    setTabs((prev) => [
      ...prev,
      {
        id: tabId,
        label: `${dirName} (resumed)`,
        workingDir: projectPath,
        mode: "terminal",
        tool: cliTool,
        resumeSessionId: sessionId,
        status: "idle",
      },
    ]);
    setActiveTabId(tabId);
    setWorkingDir(projectPath);
    setActiveSessionId(null);
    setActiveProject(null);
    setShowLaunchpad(false);
    setShowCodexUsage(false);
  }, []);

  // 创建 git worktree 并打开为新 tab
  const handleCreateWorktree = useCallback(async (branch: string) => {
    if (!workingDir) throw new Error("当前没有打开项目目录");
    try {
      const result = await invoke<{ path: string; branch: string }>("create_worktree", { path: workingDir, branch });
      const tabId = `tab-${Date.now()}`;
      const dirName = result.path.split("/").pop() || branch;
      setTabs((prev) => [
        ...prev,
        { id: tabId, label: dirName, workingDir: result.path, mode: "terminal", isWorktree: true, worktreeParentDir: workingDir, status: "idle" },
      ]);
      setActiveTabId(tabId);
      setWorkingDir(result.path);
      setActiveSessionId(null);
      setActiveProject(null);
      setShowLaunchpad(false);
      setShowCodexUsage(false);
    } catch (e) {
      console.error("Failed to create worktree:", e);
      throw e;
    }
  }, [workingDir]);

  const handleToggleLaunchpad = useCallback(() => {
    setShowLaunchpad((prev) => {
      const next = !prev;
      if (next) setShowCodexUsage(false);
      return next;
    });
  }, []);

  const handleToggleCodexUsage = useCallback(() => {
    setShowCodexUsage((prev) => {
      const next = !prev;
      if (next) setShowLaunchpad(false);
      return next;
    });
  }, []);

  const handleNewSession = useCallback(async () => {
    await handleNewTab();
  }, [handleNewTab]);

  const [commitRefreshKey, setCommitRefreshKey] = useState(0);

  const refreshGitInfo = useCallback(() => {
    if (!workingDir) return;
    invoke<GitInfo>("get_git_info", { path: workingDir })
      .then(setGitInfo)
      .catch(() => setGitInfo(null));
    setCommitRefreshKey((k) => k + 1);
  }, [workingDir]);

  // Fetch git info when working directory changes
  useEffect(() => {
    if (!workingDir) {
      setGitInfo(null);
      return;
    }
    let pending = false;
    const fetchGit = () => {
      if (pending) return; // 防止上一次还没返回时重复发起
      pending = true;
      invoke<GitInfo>("get_git_info", { path: workingDir })
        .then(setGitInfo)
        .catch(() => setGitInfo(null))
        .finally(() => { pending = false; });
    };
    fetchGit();
    const interval = setInterval(fetchGit, 5000);
    return () => clearInterval(interval);
  }, [workingDir]);

  // Refs to keep the keydown handler in sync with latest state
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey) return;

      switch (e.key) {
        case "t": {
          e.preventDefault();
          handleNewTab();
          break;
        }
        case "w": {
          e.preventDefault();
          const currentTabId = activeTabIdRef.current;
          if (currentTabId) {
            handleCloseTab(currentTabId);
          }
          break;
        }
        case "b": {
          e.preventDefault();
          setSidebarOpen((prev) => !prev);
          break;
        }
        case "e": {
          e.preventDefault();
          setShowFileTree((prev) => !prev);
          break;
        }
        case "A": {
          // Cmd+Shift+A 切换快捷按钮面板
          e.preventDefault();
          setShowQuickActions((prev) => !prev);
          break;
        }
        case "B": {
          // Cmd+Shift+B 切换 Bug 看板
          e.preventDefault();
          setShowBugTracker((prev) => !prev);
          break;
        }
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9": {
          e.preventDefault();
          const index = parseInt(e.key, 10) - 1;
          const currentTabs = tabsRef.current;
          if (index < currentTabs.length) {
            handleSelectTab(currentTabs[index].id);
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNewTab, handleCloseTab, handleSelectTab]);

  // Listen for window close request from backend
  useEffect(() => {
    const unlisten = listen("close-requested", () => {
      setShowCloseConfirm(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 快捷按钮面板：向当前活跃终端发送命令
  const handleQuickActionCommand = useCallback((command: string) => {
    // 找到当前活跃 tab 对应的 sessionId
    const currentTabId = activeTabId;
    if (!currentTabId) return;
    for (const [sessionId, tabId] of sessionTabMap.current.entries()) {
      if (tabId === currentTabId) {
        invoke("send_input", { sessionId, data: command + "\n" }).catch(() => {});
        return;
      }
    }
  }, [activeTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const showingTab = activeTabId !== null && activeTab !== undefined;
  const isWorkspaceVisible = !showLaunchpad && !showCodexUsage;

  // Welcome screen when nothing is selected
  const showWelcome = isWorkspaceVisible && !showingTab && !activeSessionId;

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]" onContextMenu={(e) => e.preventDefault()}>
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectHistorySession}
            onNewSession={handleNewSession}
            onOpenProject={handleOpenProject}
            onResumeSession={handleResumeSession}
          />
        )}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header bar — relative z-20 让分支下拉菜单浮在右侧面板上方 */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex-nowrap min-w-0 relative z-20">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-6 h-6 flex flex-col items-center justify-center gap-[3px] rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150"
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <span className="block w-3 h-[1.5px] bg-current rounded-full" />
              <span className="block w-3 h-[1.5px] bg-current rounded-full" />
              <span className="block w-3 h-[1.5px] bg-current rounded-full" />
            </button>
            <span className="text-xs text-[var(--text-secondary)] truncate">
              {showLaunchpad
                ? "Project Launchpad"
                : showCodexUsage
                ? "Codex API Usage"
                : showingTab
                ? activeTab.workingDir
                : activeSessionId
                  ? `session: ${activeSessionId.slice(0, 8)}...`
                  : "Coding Desktop"}
            </span>
            {isWorkspaceVisible && workingDir && (
              <button
                onClick={() => invoke("open_terminal", { path: workingDir }).catch(() => {})}
                className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150 shrink-0"
                title="在终端中打开"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="2" width="14" height="12" rx="2" />
                  <polyline points="4,7 7,9.5 4,12" />
                  <line x1="9" y1="12" x2="12" y2="12" />
                </svg>
              </button>
            )}
            {isWorkspaceVisible && workingDir && (
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <BranchSwitcher
                  gitInfo={gitInfo}
                  workingDir={workingDir}
                  onBranchSwitched={refreshGitInfo}
                  onCreateWorktree={handleCreateWorktree}
                />
              </div>
            )}
          </div>

          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              splitTabId={splitTabId}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onNewTab={handleNewTab}
              onReorderTabs={handleReorderTabs}
              onDragStateChange={handleTabDragStateChange}
            />
          )}

          <div className="flex-1 flex overflow-hidden">
            {/* Main content area */}
            <div
              className="flex-1 relative overflow-hidden"
              onPointerMove={handleContentPointerMove}
              onPointerUp={handleContentPointerUp}
            >
              <div
                className={`absolute inset-0 ${showLaunchpad ? "block" : "hidden"}`}
              >
                <LaunchpadPanel />
              </div>

              <div
                className={`absolute inset-0 ${showCodexUsage ? "block" : "hidden"}`}
              >
                <CodexUsagePanel />
              </div>

              {/* Mode picker - shown when tab is terminal mode but not yet activated */}
              {tabs
                .filter((tab) => tab.mode === "terminal" && !terminalActivated.has(tab.id))
                .map((tab) => (
                  <div
                    key={`pick-${tab.id}`}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ display: isWorkspaceVisible && tab.id === activeTabId ? "flex" : "none" }}
                  >
                    <div className="w-full max-w-[860px] px-6 text-center">
                      <div className="text-sm mb-1 text-[var(--text-primary)] font-medium">
                        {tab.label}
                      </div>
                      {gitInfo && workingDir === tab.workingDir ? (
                        <BranchSwitcher
                          gitInfo={gitInfo}
                          workingDir={tab.workingDir}
                          onBranchSwitched={refreshGitInfo}
                          onCreateWorktree={handleCreateWorktree}
                          variant="mode-picker"
                          pathLabel={tab.workingDir}
                          className="mb-6"
                        />
                      ) : (
                        <div className="text-[10px] mb-6 text-[var(--text-muted)] truncate">
                          {tab.workingDir}
                        </div>
                      )}
                      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="group flex min-h-[140px] min-w-0 flex-col justify-between overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] transition-all duration-150 hover:border-[#10a37f] hover:bg-[var(--bg-hover)]">
                          <button
                            onClick={() => handleStartCodexTerminal(tab.id, "codex_sub")}
                            className="w-full cursor-pointer px-5 py-4"
                          >
                            <div className="text-sm font-medium text-[#10a37f] mb-1">Codex 订阅</div>
                            <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                              使用隔离目录启动，不影响默认 API
                            </div>
                          </button>
                          <div className="px-3 pb-3">
                            <div className="relative">
                              <select
                                value={codexPermissionModes.codex_sub}
                                onChange={(event) => handleCodexPermissionChange("codex_sub", event.target.value as CodexPermissionMode)}
                                className="h-8 w-full cursor-pointer appearance-none rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] pl-3 pr-8 text-xs text-[var(--text-secondary)] outline-none hover:text-[var(--text-primary)]"
                              >
                                {CODEX_PERMISSION_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value} className="bg-[var(--bg-primary)] text-[var(--text-primary)]">
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--text-muted)]">▼</span>
                            </div>
                          </div>
                        </div>
                        <div className="group flex min-h-[140px] min-w-0 flex-col justify-between overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] transition-all duration-150 hover:border-[#10a37f] hover:bg-[var(--bg-hover)]">
                          <button
                            onClick={() => handleStartCodexTerminal(tab.id, "codex")}
                            className="w-full cursor-pointer px-5 py-4"
                          >
                            <div className="text-sm font-medium text-[#10a37f] mb-1">本地配置 Codex</div>
                            <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                              使用本机默认 Codex 配置
                            </div>
                          </button>
                          <div className="px-3 pb-3">
                            <div className="relative">
                              <select
                                value={codexPermissionModes.codex}
                                onChange={(event) => handleCodexPermissionChange("codex", event.target.value as CodexPermissionMode)}
                                className="h-8 w-full cursor-pointer appearance-none rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] pl-3 pr-8 text-xs text-[var(--text-secondary)] outline-none hover:text-[var(--text-primary)]"
                              >
                                {CODEX_PERMISSION_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value} className="bg-[var(--bg-primary)] text-[var(--text-primary)]">
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--text-muted)]">▼</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => setMoreModePickerTabId((current) => current === tab.id ? null : tab.id)}
                          className="group flex min-h-[140px] min-w-0 cursor-pointer flex-col items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-5 py-4 transition-all duration-150 hover:border-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]"
                        >
                          <div className="text-sm font-medium text-[var(--accent-cyan)] mb-1">更多</div>
                          <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                            其他启动方式
                          </div>
                        </button>
                        {moreModePickerTabId === tab.id && (
                          <div className="col-span-1 mt-1 grid grid-cols-1 gap-3 border-t border-[var(--border-subtle)] pt-4 sm:col-span-3 sm:grid-cols-4">
                            <button
                              onClick={() => handleStartTerminal(tab.id, false)}
                              className="group min-w-0 cursor-pointer rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-3 transition-all duration-150 hover:border-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]"
                            >
                              <div className="text-sm font-medium text-[var(--accent-cyan)] mb-1">Normal</div>
                              <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                                Need permission for each action
                              </div>
                            </button>
                            <button
                              onClick={() => handleStartTerminal(tab.id, true)}
                              className="group min-w-0 cursor-pointer rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-3 transition-all duration-150 hover:border-[var(--accent-orange)] hover:bg-[var(--bg-hover)]"
                            >
                              <div className="text-sm font-medium text-[var(--accent-orange)] mb-1">YOLO</div>
                              <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                                Skip all permission prompts
                              </div>
                            </button>
                            <button
                              onClick={() => handleStartTerminal(tab.id, false, "gemini")}
                              className="group min-w-0 cursor-pointer rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-3 transition-all duration-150 hover:border-[#4285F4] hover:bg-[var(--bg-hover)]"
                            >
                              <div className="text-sm font-medium text-[#4285F4] mb-1">Gemini</div>
                              <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                                Google Gemini CLI
                              </div>
                            </button>
                            <button
                              onClick={() => handleStartTerminal(tab.id, false, "volc")}
                              className="group min-w-0 cursor-pointer rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-3 transition-all duration-150 hover:border-[#FF6B35] hover:bg-[var(--bg-hover)]"
                            >
                              <div className="text-sm font-medium text-[#FF6B35] mb-1">火山</div>
                              <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                                火山 CodingPlan
                              </div>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

              {/* 分屏 drop zone 高亮 */}
              {!showLaunchpad && tabDragging && showDropZone && (
                <div className="absolute inset-y-0 right-0 w-1/2 z-20 bg-[var(--accent-cyan)]/10 border-2 border-dashed border-[var(--accent-cyan)] rounded-r-lg pointer-events-none flex items-center justify-center">
                  <span className="text-sm text-[var(--accent-cyan)] font-medium">Split Right</span>
                </div>
              )}

              {/* Terminal mode tabs - only mount if terminal was ever activated */}
              {tabs
                .filter((tab) => terminalActivated.has(tab.id))
                .map((tab) => {
                  const isActive = tab.id === activeTabId && tab.mode === "terminal";
                  const isSplit = splitTabId !== null && tab.id === splitTabId && tab.mode === "terminal";
                  const visible = isWorkspaceVisible && (isActive || isSplit);

                  let posStyle: React.CSSProperties = {};
                  if (splitTabId) {
                    if (isActive) {
                      posStyle = { left: 0, width: `calc(${splitRatio * 100}% - 2px)`, right: "auto" };
                    } else if (isSplit) {
                      posStyle = { right: 0, width: `calc(${(1 - splitRatio) * 100}% - 2px)`, left: "auto" };
                    }
                  }

                  return (
                    <div
                      key={`term-${tab.id}`}
                      className="absolute inset-0 flex flex-col"
                      style={{ display: visible ? "flex" : "none", ...posStyle }}
                    >
                      <div className="flex-1 overflow-hidden">
                        <LiveTerminal
                          workingDir={tab.workingDir}
                          yolo={tab.yolo}
                          tool={tab.tool}
                          permissionMode={tab.permissionMode}
                          resumeSessionId={tab.resumeSessionId}
                          isActive={isWorkspaceVisible && isActive}
                          onSessionStarted={(sessionId) => handleSessionStarted(tab.id, sessionId)}
                          onError={() => updateTabStatus(tab.id, "error")}
                        />
                      </div>
                    </div>
                  );
                })}

              {/* 分屏分隔线 */}
              {!showLaunchpad && splitTabId && (
                <div
                  className="absolute top-0 bottom-0 z-10"
                  style={{ left: `calc(${splitRatio * 100}% - 2px)` }}
                >
                  <SplitDivider onRatioChange={setSplitRatio} />
                </div>
              )}

              {/* 分屏关闭按钮 */}
              {!showLaunchpad && splitTabId && (
                <button
                  onClick={handleCloseSplit}
                  className="absolute top-1 z-10 w-5 h-5 flex items-center justify-center rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                  style={{ right: 4 }}
                  title="Close split"
                >
                  ✕
                </button>
              )}

              {/* History session view */}
              {activeSessionId && (
                <div
                  className="absolute inset-0 flex flex-col overflow-hidden"
                  style={{ display: isWorkspaceVisible && !showingTab ? "flex" : "none" }}
                >
                  <ChatArea
                    sessionId={activeSessionId}
                    projectSlug={activeProject}
                  />
                </div>
              )}

              {/* Welcome screen */}
              {showWelcome && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center max-w-sm w-full px-6">
                    <div className="text-lg mb-1 text-[var(--text-primary)] font-medium">
                      Coding Desktop
                    </div>
                    <div className="text-xs mb-8 text-[var(--text-muted)]">
                      Select a project folder to start a new coding session
                    </div>
                    <button
                      onClick={handleNewTab}
                      className="w-full py-2.5 px-4 text-sm font-medium bg-[var(--accent-cyan)] text-[#0d1117] rounded-lg hover:brightness-110 active:brightness-90 transition-all duration-150 cursor-pointer shadow-md shadow-[var(--accent-cyan)]/20"
                    >
                      Choose Folder...
                    </button>
                    <div className="text-[10px] mt-4 text-[var(--text-muted)]">
                      Or select a past session from the sidebar
                    </div>
                    <div className="mt-6 flex items-center justify-center gap-4 text-[10px] text-[var(--text-muted)]">
                      <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">&#8984;T</kbd> New tab</span>
                      <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">&#8984;B</kbd> Sidebar</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Actions panel - right side */}
            {isWorkspaceVisible && showQuickActions && workingDir && (
              <QuickActionsPanel
                workingDir={workingDir}
                onClose={() => setShowQuickActions(false)}
                onSendCommand={handleQuickActionCommand}
              />
            )}

            {/* Bug tracker panel - right side */}
            {isWorkspaceVisible && showBugTracker && workingDir && (
              <BugTrackerPanel workingDir={workingDir} onClose={() => setShowBugTracker(false)} />
            )}

            {/* Commit history panel - right side */}
            {isWorkspaceVisible && showCommits && workingDir && (
              <CommitHistory key={commitRefreshKey} workingDir={workingDir} onClose={() => setShowCommits(false)} />
            )}

            {/* File tree panel - right side */}
            {isWorkspaceVisible && showFileTree && workingDir && <FileTree rootPath={workingDir} />}

            {/* Skills panel overlay */}
            {isWorkspaceVisible && showSkills && (
              <div className="w-72 border-l border-[var(--border-subtle)] relative">
                <SkillsPanel onClose={() => setShowSkills(false)} workingDir={workingDir} />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex">
        <StatusBar />
        <button
          onClick={() => setShowSkills(!showSkills)}
          className={`px-2.5 py-0.5 text-[10px] border-t border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] cursor-pointer transition-colors duration-150 ${
            showSkills ? "text-[var(--accent-purple)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Skills
        </button>
        <button
          onClick={() => setShowQuickActions(!showQuickActions)}
          className={`px-2.5 py-0.5 text-[10px] border-t border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] cursor-pointer transition-colors duration-150 ${
            showQuickActions ? "text-[var(--accent-orange)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
          title="快捷操作 (⌘⇧A)"
        >
          Actions
        </button>
        <button
          onClick={() => setShowBugTracker(!showBugTracker)}
          className={`px-2.5 py-0.5 text-[10px] border-t border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] cursor-pointer transition-colors duration-150 ${
            showBugTracker ? "text-[var(--accent-red)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
          title="Bug 看板"
        >
          Bugs
        </button>
        <button
          onClick={() => setShowCommits(!showCommits)}
          className={`px-2.5 py-0.5 text-[10px] border-t border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] cursor-pointer transition-colors duration-150 ${
            showCommits ? "text-[var(--accent-blue)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Commits
        </button>
        <button
          onClick={() => setShowFileTree(!showFileTree)}
          className={`px-2.5 py-0.5 text-[10px] border-t border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] cursor-pointer transition-colors duration-150 ${
            showFileTree ? "text-[var(--accent-cyan)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Files
        </button>
        <button
          onClick={handleToggleLaunchpad}
          className={`px-3 py-0.5 text-[10px] border-t border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] cursor-pointer transition-colors duration-150 ${
            showLaunchpad ? "text-[var(--accent-cyan)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
          title="项目启动面板"
        >
          Launchpad
        </button>
        <button
          onClick={handleToggleCodexUsage}
          className={`px-3 py-0.5 text-[10px] border-t border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] cursor-pointer transition-colors duration-150 ${
            showCodexUsage ? "text-[var(--accent-cyan)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
          title="Codex API 用量"
        >
          API Use
        </button>
      </div>

      {/* Tab close confirmation modal */}
      {tabToClose && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }}
          onClick={() => setTabToClose(null)}
        >
          <div
            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-[var(--text-primary)] mb-2">
              关闭终端？
            </div>
            <div className="text-xs text-[var(--text-muted)] mb-6">
              确定要关闭「{tabs.find((t) => t.id === tabToClose)?.label ?? ""}」吗？正在运行的会话将被终止。
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setTabToClose(null)}
                className="px-4 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150 border border-[var(--border-subtle)]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  doCloseTab(tabToClose);
                  setTabToClose(null);
                }}
                className="px-4 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 cursor-pointer transition-colors duration-150"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close confirmation modal */}
      {showCloseConfirm && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }}
        >
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="text-sm font-medium text-[var(--text-primary)] mb-2">
              Quit Application?
            </div>
            <div className="text-xs text-[var(--text-muted)] mb-6">
              Are you sure you want to quit? Any running sessions will be terminated.
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="px-4 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150 border border-[var(--border-subtle)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  invoke("confirm_close").catch(() => {});
                }}
                className="px-4 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 cursor-pointer transition-colors duration-150"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
