import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTheme } from "../hooks/useTheme";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "update-available" | "downloading" | "installing" | "done" | "error";

interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  download_url: string;
}

const APP_VERSION = "0.6.2";

export default function StatusBar() {
  const { mode, setMode } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const checkCancelledRef = useRef(false);

  const cycleTheme = () => {
    setMode((prev) => {
      if (prev === "dark") return "light";
      if (prev === "light") return "system";
      return "dark";
    });
  };

  const themeLabel = mode === "dark" ? "\u25CF Dark" : mode === "light" ? "\u25CB Light" : "\u25D0 Auto";

  const handleCancelCheck = useCallback(() => {
    checkCancelledRef.current = true;
    setUpdateStatus("idle");
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    if (updateStatus === "checking" || updateStatus === "downloading") return;
    checkCancelledRef.current = false;
    setUpdateStatus("checking");
    try {
      const info = await Promise.race([
        invoke<UpdateInfo>("check_for_update"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Update check timed out after 15 seconds")), 15000)
        ),
      ]);
      if (checkCancelledRef.current) return;
      if (info.update_available) {
        setLatestVersion(info.latest_version);
        setDownloadUrl(info.download_url);
        setUpdateStatus("update-available");
      } else {
        setUpdateStatus("up-to-date");
        setTimeout(() => setUpdateStatus("idle"), 3000);
      }
    } catch (e: unknown) {
      if (checkCancelledRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Update check error:", msg);
      setUpdateStatus("error");
      setErrorMsg(msg);
      setTimeout(() => setUpdateStatus("idle"), 5000);
    }
  }, [updateStatus]);

  const handleDownloadAndInstall = useCallback(async () => {
    if (!downloadUrl) return;
    try {
      setUpdateStatus("downloading");
      setDownloadProgress(0);
      await invoke("download_and_install_update", { url: downloadUrl });
      setUpdateStatus("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setUpdateStatus("error");
      setErrorMsg(msg);
      setTimeout(() => setUpdateStatus("idle"), 5000);
    }
  }, [downloadUrl]);

  const handleRelaunch = useCallback(async () => {
    await relaunch();
  }, []);

  const renderUpdateContent = () => {
    switch (updateStatus) {
      case "checking":
        return (
          <span className="text-[var(--text-secondary)] animate-pulse">
            Checking...{" "}
            <button
              onClick={handleCancelCheck}
              className="text-[var(--text-muted)] hover:text-[var(--accent-red)] cursor-pointer bg-transparent border-none p-0 text-[10px]"
            >
              Cancel
            </button>
          </span>
        );
      case "up-to-date":
        return <span className="text-[var(--accent-green)]">Up to date</span>;
      case "update-available":
        return (
          <span className="text-[var(--accent-orange)]">
            v{latestVersion} available{" · "}
            <button
              onClick={handleDownloadAndInstall}
              className="underline hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-none p-0 text-[10px] text-[var(--accent-orange)]"
            >
              Update Now
            </button>
          </span>
        );
      case "downloading":
        return (
          <span className="text-[var(--accent-cyan)] animate-pulse">
            Downloading {downloadProgress > 0 ? `${downloadProgress}%` : "..."}
          </span>
        );
      case "done":
        return (
          <span className="text-[var(--accent-green)]">
            Ready{" · "}
            <button
              onClick={handleRelaunch}
              className="underline hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-none p-0 text-[10px] text-[var(--accent-green)]"
            >
              Restart Now
            </button>
          </span>
        );
      case "error":
        return <span className="text-[var(--accent-red)]" title={errorMsg}>Update failed</span>;
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
      <div className="flex items-center justify-between px-3 py-0.5 text-[10px]">
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-muted)]">v{APP_VERSION}</span>
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
