import { useState, useCallback, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTheme } from "../hooks/useTheme";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "update-available" | "downloading" | "installing" | "done" | "error";

const APP_VERSION = "0.6.0";

export default function StatusBar() {
  const { mode, setMode } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateRef, setUpdateRef] = useState<Awaited<ReturnType<typeof check>> | null>(null);
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
      // Race between check() and a 15s timeout
      const update = await Promise.race([
        check(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("Update check timed out after 15 seconds")), 15000)
        ),
      ]);
      if (checkCancelledRef.current) return;
      if (update) {
        setLatestVersion(update.version);
        setUpdateRef(update);
        setUpdateStatus("update-available");
      } else {
        setUpdateStatus("up-to-date");
        setTimeout(() => setUpdateStatus("idle"), 3000);
      }
    } catch (e: unknown) {
      if (checkCancelledRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Up to date") || msg.includes("up to date") || msg.includes("no update")) {
        setUpdateStatus("up-to-date");
        setTimeout(() => setUpdateStatus("idle"), 3000);
      } else {
        console.error("Update check error:", msg);
        setUpdateStatus("error");
        setErrorMsg(msg);
        setTimeout(() => setUpdateStatus("idle"), 5000);
      }
    }
  }, [updateStatus]);

  const handleDownloadAndInstall = useCallback(async () => {
    if (!updateRef) return;
    try {
      setUpdateStatus("downloading");
      let totalBytes = 0;
      let downloadedBytes = 0;
      await updateRef.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setDownloadProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        } else if (event.event === "Finished") {
          setUpdateStatus("done");
        }
      });
      setUpdateStatus("done");
    } catch {
      setUpdateStatus("error");
      setTimeout(() => setUpdateStatus("idle"), 3000);
    }
  }, [updateRef]);

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
