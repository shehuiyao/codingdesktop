import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTheme } from "../hooks/useTheme";

interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  download_url: string;
}

type UpdateStatus = "idle" | "checking" | "up-to-date" | "update-available" | "downloading" | "installing" | "error";

export default function StatusBar() {
  const { mode, setMode } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  // Listen for download progress events from backend
  useEffect(() => {
    const unlisten = listen<string>("update-progress", (event) => {
      const msg = event.payload;
      if (msg === "Downloading...") {
        setUpdateStatus("downloading");
      } else if (msg === "Opening installer...") {
        setUpdateStatus("installing");
      } else if (msg === "done") {
        setUpdateStatus("idle");
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const cycleTheme = () => {
    setMode((prev) => {
      if (prev === "dark") return "light";
      if (prev === "light") return "system";
      return "dark";
    });
  };

  const themeLabel = mode === "dark" ? "\u25CF Dark" : mode === "light" ? "\u25CB Light" : "\u25D0 Auto";

  const handleCheckUpdate = useCallback(() => {
    if (updateStatus === "checking" || updateStatus === "downloading") return;
    setUpdateStatus("checking");
    invoke<UpdateInfo>("check_for_update")
      .then((info) => {
        if (info.update_available) {
          setLatestVersion(info.latest_version);
          setDownloadUrl(info.download_url);
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

  const handleDownloadUpdate = useCallback(() => {
    if (!downloadUrl) return;
    setUpdateStatus("downloading");
    invoke("download_and_install_update", { url: downloadUrl })
      .catch(() => {
        setUpdateStatus("error");
        setTimeout(() => setUpdateStatus("idle"), 3000);
      });
  }, [downloadUrl]);

  const renderUpdateContent = () => {
    switch (updateStatus) {
      case "checking":
        return <span className="text-[var(--text-secondary)] animate-pulse">Checking...</span>;
      case "up-to-date":
        return <span className="text-[var(--accent-green)]">Up to date</span>;
      case "update-available":
        return (
          <span className="text-[var(--accent-orange)]">
            v{latestVersion} available
            {" · "}
            <button
              onClick={handleDownloadUpdate}
              className="underline hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-none p-0 text-[10px] text-[var(--accent-orange)]"
            >
              Download & Install
            </button>
          </span>
        );
      case "downloading":
        return <span className="text-[var(--accent-cyan)] animate-pulse">Downloading...</span>;
      case "installing":
        return <span className="text-[var(--accent-green)] animate-pulse">Opening installer...</span>;
      case "error":
        return <span className="text-[var(--accent-red)]">Update failed</span>;
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
      <div className="flex items-center justify-between px-3 py-0.5 text-[10px]">
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-muted)]">v0.5.3</span>
          <button
            onClick={handleCheckUpdate}
            disabled={updateStatus === "checking" || updateStatus === "downloading"}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer transition-colors duration-150 bg-transparent border-none p-0 text-[10px] disabled:opacity-50 disabled:cursor-default"
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
