import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import TerminalPanel from "./components/Terminal";
import StatusBar from "./components/StatusBar";
import FileTree from "./components/FileTree";
import TabBar, { type Tab } from "./components/TabBar";

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showFileTree, setShowFileTree] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [workingDir, setWorkingDir] = useState<string | null>(null);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

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
        { id: tabId, label: dirName, workingDir: selected },
      ]);
      setActiveTabId(tabId);
      // Clear history session view when switching to tabs
      setActiveSessionId(null);
      setActiveProject(null);
    }
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
        }
        return remaining;
      });
    },
    [activeTabId],
  );

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setActiveSessionId(null);
    setActiveProject(null);
  }, []);

  const handleSelectHistorySession = useCallback(
    (projectSlug: string, sessionId: string) => {
      setActiveProject(projectSlug);
      setActiveSessionId(sessionId);
      setActiveTabId(null);
    },
    [],
  );

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
    setActiveProject(null);
    setActiveTabId(null);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const showingTab = activeTabId !== null && activeTab !== undefined;

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectHistorySession}
            onNewSession={handleNewSession}
          />
        )}
        <div className="flex-1 flex flex-col overflow-hidden">
          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onNewTab={handleNewTab}
            />
          )}
          <div className="flex-1 flex overflow-hidden relative">
            {/* Render tab ChatAreas - keep mounted to preserve state */}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className="absolute inset-0 flex"
                style={{ display: tab.id === activeTabId ? "flex" : "none" }}
              >
                <ChatArea
                  sessionId={null}
                  projectSlug={null}
                  onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                  onWorkingDirChange={setWorkingDir}
                  initialDir={tab.workingDir}
                />
              </div>
            ))}
            {/* Default view (no tab selected) */}
            {!showingTab && (
              <ChatArea
                sessionId={activeSessionId}
                projectSlug={activeProject}
                onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                onWorkingDirChange={setWorkingDir}
              />
            )}
            {showFileTree && workingDir && <FileTree rootPath={workingDir} />}
          </div>
        </div>
      </div>
      {showTerminal && <TerminalPanel />}
      <div className="flex">
        <StatusBar />
        <button
          onClick={() => setShowFileTree(!showFileTree)}
          className="px-2 py-1 text-xs border-t border-l border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          {showFileTree ? "Hide Files" : "Show Files"}
        </button>
        <button
          onClick={() => setShowTerminal(!showTerminal)}
          className="px-2 py-1 text-xs border-t border-l border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          {showTerminal ? "Hide Terminal" : "Show Terminal"}
        </button>
      </div>
    </div>
  );
}

export default App;
