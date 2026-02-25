import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../hooks/useTheme";

interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
}

export default function StatusBar() {
  const { mode, setMode } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "up-to-date" | "update-available" | "error"
  >("idle");
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [releaseUrl, setReleaseUrl] = useState<string>("");

  const cycleTheme = () => {
    setMode((prev) => {
      if (prev === "dark") return "light";
      if (prev === "light") return "system";
      return "dark";
    });
  };

  const themeLabel = mode === "dark" ? "\u25CF Dark" : mode === "light" ? "\u25CB Light" : "\u25D0 Auto";

  const handleCheckUpdate = useCallback(() => {
    if (updateStatus === "checking") return;
    setUpdateStatus("checking");
    invoke<UpdateInfo>("check_for_update")
      .then((info) => {
        if (info.update_available) {
          setLatestVersion(info.latest_version);
          setReleaseUrl(info.release_url);
          setUpdateStatus("update-available");
        } else {
          setUpdateStatus("up-to-date");
          setTimeout(() => setUpdateStatus("idle"), 3000);
        }
      })
      .catch(() => {
        setUpdateStatus("error");
        setTimeout(() => setUpdateStatus("idle"), 3000);
      });
  }, [updateStatus]);

  const renderUpdateContent = () => {
    switch (updateStatus) {
      case "checking":
        return (
          <span className="text-[var(--text-secondary)] animate-pulse">
            Checking...
          </span>
        );
      case "up-to-date":
        return (
          <span className="text-[var(--accent-green)]">Up to date</span>
        );
      case "update-available":
        return (
          <span className="text-[var(--accent-orange)]">
            v{latestVersion} available
            {releaseUrl && (
              <>
                {" · "}
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Download
                </a>
              </>
            )}
          </span>
        );
      case "error":
        return (
          <span className="text-[var(--accent-red)]">Check failed</span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
      <div className="flex items-center justify-between px-3 py-0.5 text-[10px]">
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-muted)]">v0.5.2</span>
          <button
            onClick={handleCheckUpdate}
            disabled={updateStatus === "checking"}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer transition-colors duration-150 bg-transparent border-none p-0 text-[10px] disabled:opacity-50 disabled:cursor-default"
            title="Check for updates"
          >
            Check for Updates
          </button>
          {renderUpdateContent()}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={cycleTheme}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer transition-colors duration-150 bg-transparent border-none p-0 text-[10px]"
            title={`Theme: ${mode} (click to cycle)`}
          >
            {themeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
