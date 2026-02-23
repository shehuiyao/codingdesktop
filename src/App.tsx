import { useState, useCallback, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import ChatView from "./components/ChatView";
import LiveTerminal from "./components/LiveTerminal";
import StatusBar from "./components/StatusBar";
import FileTree from "./components/FileTree";
import SkillsPanel from "./components/SkillsPanel";
import TabBar, { type Tab } from "./components/TabBar";

interface GitInfo {
  branch: string;
  additions: number;
  deletions: number;
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showFileTree, setShowFileTree] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [workingDir, setWorkingDir] = useState<string | null>(null);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Track tabs that have had terminal mode activated (for lazy mounting)
  const [terminalActivated, setTerminalActivated] = useState<Set<string>>(new Set());

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
        { id: tabId, label: dirName, workingDir: selected, mode: "terminal" },
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

  const handleStartTerminal = useCallback((tabId: string, yolo: boolean) => {
    setTerminalActivated((prev) => new Set(prev).add(tabId));
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, mode: "terminal" as const, yolo } : t))
    );
  }, []);

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
      { id: tabId, label: dirName, workingDir: projectPath, mode: "terminal" },
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
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
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
            {gitInfo && (
              <span className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
                <span className="flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--accent-orange)]">
                    <path d="M5.45 3.18a.7.7 0 0 0-.99 0L.73 6.91a.7.7 0 0 0 0 .99l3.73 3.73a.7.7 0 0 0 .99-.99L2.22 7.4l3.23-3.23a.7.7 0 0 0 0-.99zm5.1 0a.7.7 0 0 1 .99 0l3.73 3.73a.7.7 0 0 1 0 .99l-3.73 3.73a.7.7 0 0 1-.99-.99L13.78 7.4l-3.23-3.23a.7.7 0 0 1 0-.99z"/>
                  </svg>
                  {gitInfo.branch}
                </span>
                <span className="text-[var(--accent-green)]">+{gitInfo.additions}</span>
                <span className="text-[var(--accent-red)]">-{gitInfo.deletions}</span>
              </span>
            )}
            {showingTab && (
              <span className={`ml-auto flex items-center gap-1.5 text-[10px] ${
                activeTab.yolo ? "text-[var(--accent-orange)]" : "text-[var(--accent-green)]"
              }`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full animate-pulse ${
                  activeTab.yolo ? "bg-[var(--accent-orange)]" : "bg-[var(--accent-green)]"
                }`} />
                {activeTab.mode === "chat" ? "chat" : activeTab.yolo ? "yolo" : "terminal"}
              </span>
            )}
          </div>

          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onNewTab={handleNewTab}
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
                      <div className="flex gap-3 justify-center">
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
                        {tab.yolo ? "YOLO Mode" : "Terminal Mode"}
                      </span>
                      <button
                        onClick={() => handleSwitchMode(tab.id, "chat")}
                        className="px-2 py-1 text-[10px] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150"
                      >
                        Switch to Chat
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <LiveTerminal workingDir={tab.workingDir} yolo={tab.yolo} />
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

            {/* File tree panel - right side */}
            {showFileTree && workingDir && <FileTree rootPath={workingDir} />}

            {/* Skills panel overlay */}
            {showSkills && (
              <div className="w-72 border-l border-[var(--border-subtle)] relative">
                <SkillsPanel onClose={() => setShowSkills(false)} />
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
          onClick={() => setShowFileTree(!showFileTree)}
          className={`px-2.5 py-0.5 text-[10px] border-t border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] cursor-pointer transition-colors duration-150 ${
            showFileTree ? "text-[var(--accent-cyan)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Files
        </button>
      </div>
    </div>
  );
}

export default App;
