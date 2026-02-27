import { useState, useCallback, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import ChatView from "./components/ChatView";
import LiveTerminal from "./components/LiveTerminal";
import StatusBar from "./components/StatusBar";
import FileTree from "./components/FileTree";
import SkillsPanel from "./components/SkillsPanel";
import BranchSwitcher from "./components/BranchSwitcher";
import CommitHistory from "./components/CommitHistory";
import TabBar, { type Tab, type CliTool } from "./components/TabBar";

interface GitInfo {
  branch: string;
  additions: number;
  deletions: number;
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showFileTree, setShowFileTree] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [workingDir, setWorkingDir] = useState<string | null>(null);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Track tabs that have had terminal mode activated (for lazy mounting)
  const [terminalActivated, setTerminalActivated] = useState<Set<string>>(new Set());
  // Map sessionId -> tabId for correlating pty events to tabs
  const sessionTabMap = useRef<Map<string, string>>(new Map());

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
    }
  }, []);

  const handleCloseTab = useCallback(
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
      setTerminalActivated((prev) => {
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
      // Clean up session-to-tab mappings for this tab
      for (const [sessionId, mappedTabId] of sessionTabMap.current.entries()) {
        if (mappedTabId === tabId) {
          sessionTabMap.current.delete(sessionId);
        }
      }
    },
    [activeTabId],
  );

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setActiveSessionId(null);
    setActiveProject(null);
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (tab) setWorkingDir(tab.workingDir);
      return prev;
    });
  }, []);

  const handleStartTerminal = useCallback((tabId: string, yolo: boolean, tool: CliTool = "claude") => {
    setTerminalActivated((prev) => new Set(prev).add(tabId));
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, mode: "terminal" as const, yolo, tool, status: "running" as const } : t))
    );
  }, []);

  const handleReorderTabs = useCallback((reordered: Tab[]) => {
    setTabs(reordered);
  }, []);

  // Update a specific tab's status
  const updateTabStatus = useCallback((tabId: string, status: Tab["status"]) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, status } : t))
    );
  }, []);

  // Called when a LiveTerminal session starts - maps sessionId to tabId
  const handleSessionStarted = useCallback((tabId: string, sessionId: string) => {
    sessionTabMap.current.set(sessionId, tabId);
  }, []);

  // Track which tabs have already transitioned from idle, to avoid re-renders on every pty-output
  const activatedTabsRef = useRef<Set<string>>(new Set());

  // Listen for pty-output and pty-exit events to update tab status
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setupListeners = async () => {
      const outputUn = await listen<{ id: string; data: string }>("pty-output", (event) => {
        const tabId = sessionTabMap.current.get(event.payload.id);
        if (tabId && !activatedTabsRef.current.has(tabId)) {
          // Only update once: idle -> running, then never touch again from output events
          activatedTabsRef.current.add(tabId);
          updateTabStatus(tabId, "running");
        }
      });
      unlisteners.push(outputUn);

      const exitUn = await listen<{ id: string; code?: number }>("pty-exit", (event) => {
        const tabId = sessionTabMap.current.get(event.payload.id);
        if (tabId) {
          updateTabStatus(tabId, "done");
          activatedTabsRef.current.delete(tabId);
          sessionTabMap.current.delete(event.payload.id);
        }
      });
      unlisteners.push(exitUn);

      // Listen for pty-error events to mark tab as errored
      const errorUn = await listen<{ id: string; error: string }>("pty-error", (event) => {
        const tabId = sessionTabMap.current.get(event.payload.id);
        if (tabId) {
          updateTabStatus(tabId, "error");
        }
      });
      unlisteners.push(errorUn);
    };

    setupListeners();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [updateTabStatus]);

  const handleSwitchMode = useCallback((tabId: string, mode: "chat" | "terminal") => {
    if (mode === "terminal") {
      setTerminalActivated((prev) => new Set(prev).add(tabId));
    }
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, mode } : t))
    );
  }, []);

  const handleSelectHistorySession = useCallback(
    (projectSlug: string, sessionId: string) => {
      setActiveProject(projectSlug);
      setActiveSessionId(sessionId);
      setActiveTabId(null);
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
    const fetchGit = () => {
      invoke<GitInfo>("get_git_info", { path: workingDir })
        .then(setGitInfo)
        .catch(() => setGitInfo(null));
    };
    fetchGit();
    const interval = setInterval(fetchGit, 5000);
    return () => clearInterval(interval);
  }, [workingDir]);

  // Refs to keep the keydown handler in sync with latest state
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
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

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const showingTab = activeTabId !== null && activeTab !== undefined;

  // Welcome screen when nothing is selected
  const showWelcome = !showingTab && !activeSessionId;

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectHistorySession}
            onNewSession={handleNewSession}
            onOpenProject={handleOpenProject}
          />
        )}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex-nowrap min-w-0">
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
              {showingTab
                ? activeTab.workingDir
                : activeSessionId
                  ? `session: ${activeSessionId.slice(0, 8)}...`
                  : "Claude Code Desktop"}
            </span>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <BranchSwitcher
                gitInfo={gitInfo}
                workingDir={workingDir}
                onBranchSwitched={refreshGitInfo}
              />
            {showingTab && (
              <span className={`flex items-center gap-1.5 text-[10px] ${
                activeTab.tool === "gemini" ? "text-[#4285F4]" :
                activeTab.yolo ? "text-[var(--accent-orange)]" : "text-[var(--accent-green)]"
              }`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full animate-pulse ${
                  activeTab.tool === "gemini" ? "bg-[#4285F4]" :
                  activeTab.yolo ? "bg-[var(--accent-orange)]" : "bg-[var(--accent-green)]"
                }`} />
                {activeTab.mode === "chat" ? "chat" : activeTab.tool === "gemini" ? "gemini" : activeTab.yolo ? "yolo" : "terminal"}
              </span>
            )}
            </div>
          </div>

          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onNewTab={handleNewTab}
              onReorderTabs={handleReorderTabs}
            />
          )}

          <div className="flex-1 flex overflow-hidden">
            {/* Main content area */}
            <div className="flex-1 relative overflow-hidden">
              {/* Chat mode tabs */}
              {tabs.map((tab) => (
                <div
                  key={`chat-${tab.id}`}
                  className="absolute inset-0 flex"
                  style={{ display: tab.id === activeTabId && tab.mode === "chat" ? "flex" : "none" }}
                >
                  <ChatView
                    workingDir={tab.workingDir}
                    onSwitchToTerminal={() => handleSwitchMode(tab.id, "terminal")}
                  />
                </div>
              ))}

              {/* Mode picker - shown when tab is terminal mode but not yet activated */}
              {tabs
                .filter((tab) => tab.mode === "terminal" && !terminalActivated.has(tab.id))
                .map((tab) => (
                  <div
                    key={`pick-${tab.id}`}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ display: tab.id === activeTabId ? "flex" : "none" }}
                  >
                    <div className="text-center max-w-md w-full px-6">
                      <div className="text-sm mb-1 text-[var(--text-primary)] font-medium">
                        {tab.label}
                      </div>
                      <div className="text-[10px] mb-6 text-[var(--text-muted)] truncate">
                        {tab.workingDir}
                      </div>
                      <div className="flex gap-3 justify-center flex-wrap">
                        <button
                          onClick={() => handleStartTerminal(tab.id, false)}
                          className="flex-1 max-w-[180px] py-3 px-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:border-[var(--accent-cyan)] hover:bg-[var(--bg-hover)] cursor-pointer transition-all duration-150 group"
                        >
                          <div className="text-sm font-medium text-[var(--accent-cyan)] mb-1">Normal</div>
                          <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                            Need permission for each action
                          </div>
                        </button>
                        <button
                          onClick={() => handleStartTerminal(tab.id, true)}
                          className="flex-1 max-w-[180px] py-3 px-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:border-[var(--accent-orange)] hover:bg-[var(--bg-hover)] cursor-pointer transition-all duration-150 group"
                        >
                          <div className="text-sm font-medium text-[var(--accent-orange)] mb-1">YOLO</div>
                          <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                            Skip all permission prompts
                          </div>
                        </button>
                        <button
                          onClick={() => handleStartTerminal(tab.id, false, "gemini")}
                          className="flex-1 max-w-[180px] py-3 px-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:border-[#4285F4] hover:bg-[var(--bg-hover)] cursor-pointer transition-all duration-150 group"
                        >
                          <div className="text-sm font-medium text-[#4285F4] mb-1">Gemini</div>
                          <div className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                            Google Gemini CLI
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

              {/* Terminal mode tabs - only mount if terminal was ever activated */}
              {tabs
                .filter((tab) => terminalActivated.has(tab.id))
                .map((tab) => (
                  <div
                    key={`term-${tab.id}`}
                    className="absolute inset-0 flex flex-col"
                    style={{ display: tab.id === activeTabId && tab.mode === "terminal" ? "flex" : "none" }}
                  >
                    <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                      <span className="text-xs text-[var(--text-secondary)]">
                        {tab.tool === "gemini" ? "Gemini CLI" : tab.yolo ? "YOLO Mode" : "Terminal Mode"}
                      </span>
                      <button
                        onClick={() => handleSwitchMode(tab.id, "chat")}
                        className="px-2 py-1 text-[10px] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150"
                      >
                        Switch to Chat
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <LiveTerminal
                      workingDir={tab.workingDir}
                      yolo={tab.yolo}
                      tool={tab.tool}
                      onSessionStarted={(sessionId) => handleSessionStarted(tab.id, sessionId)}
                      onError={() => updateTabStatus(tab.id, "error")}
                    />
                    </div>
                  </div>
                ))}

              {/* History session view */}
              {!showingTab && activeSessionId && (
                <div className="absolute inset-0 flex flex-col overflow-hidden">
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
                      Claude Code Desktop
                    </div>
                    <div className="text-xs mb-8 text-[var(--text-muted)]">
                      Select a project folder to start a new Claude session
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

            {/* Commit history panel - right side */}
            {showCommits && workingDir && (
              <CommitHistory key={commitRefreshKey} workingDir={workingDir} />
            )}

            {/* File tree panel - right side */}
            {showFileTree && workingDir && <FileTree rootPath={workingDir} />}

            {/* Skills panel overlay */}
            {showSkills && (
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
      </div>

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
