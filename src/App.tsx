import { useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import StatusBar from "./components/StatusBar";

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            activeSessionId={activeSessionId}
            onSelectSession={(projectSlug: string, sessionId: string) => {
              setActiveProject(projectSlug);
              setActiveSessionId(sessionId);
            }}
            onNewSession={() => {
              setActiveSessionId(null);
              setActiveProject(null);
            }}
          />
        )}
        <ChatArea
          sessionId={activeSessionId}
          projectSlug={activeProject}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
