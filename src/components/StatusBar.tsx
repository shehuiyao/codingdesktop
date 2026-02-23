import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function StatusBar() {
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("check_claude_installed")
      .then(setClaudeInstalled)
      .catch(() => setClaudeInstalled(false));
  }, []);

  return (
    <div className="flex-1 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
      <div className="flex items-center justify-between px-3 py-0.5 text-[10px]">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              claudeInstalled ? "bg-[var(--accent-green)]" : claudeInstalled === false ? "bg-[var(--accent-red)]" : "bg-[var(--text-secondary)]"
            }`}
          />
          <span>
            {claudeInstalled === null
              ? "Checking CLI..."
              : claudeInstalled
                ? "CLI Ready"
                : "CLI Not Found"}
          </span>
        </div>
        <div className="text-[var(--text-muted)]">v0.4.4</div>
      </div>
    </div>
  );
}
