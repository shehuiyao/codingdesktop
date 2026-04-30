import { useState, useCallback, useRef, useEffect } from "react";
import { check, type CheckOptions, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../hooks/useTheme";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "update-available" | "downloading" | "done" | "error";
type UpdateNetwork = "system-proxy" | "default";
type SystemProxyConfig = {
  url: string;
  source: string;
};

const APP_VERSION = "0.9.20";
const UPDATE_CHECK_TIMEOUT = 15000;
const UPDATE_DOWNLOAD_TIMEOUT = 10 * 60 * 1000;

export default function StatusBar() {
  const { mode, setMode } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedSize, setDownloadedSize] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [updateNetwork, setUpdateNetwork] = useState<UpdateNetwork>("default");
  const [errorMsg, setErrorMsg] = useState("");
  const updateRef = useRef<Update | null>(null);
  const checkCancelledRef = useRef(false);

  // 使用统计
  const [usageStats, setUsageStats] = useState<{ today_messages: number; today_sessions: number; today_tool_calls: number } | null>(null);

  useEffect(() => {
    const fetchStats = () => {
      invoke<{ today_messages: number; today_sessions: number; today_tool_calls: number }>("get_usage_stats")
        .then(setUsageStats)
        .catch(() => {});
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // 每 30 秒刷新
    return () => clearInterval(interval);
  }, []);

  const cycleTheme = () => {
    setMode((prev) => {
      if (prev === "dark") return "light";
      if (prev === "light") return "system";
      return "dark";
    });
  };

  const themeLabel = mode === "dark" ? "\u25CF Dark" : mode === "light" ? "\u25CB Light" : "\u25D0 Auto";

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return "0 MB";
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const checkWithOptions = async (options: CheckOptions, network: UpdateNetwork) => {
    const update = await check(options);
    if (!checkCancelledRef.current) {
      setUpdateNetwork(network);
    }
    return update;
  };

  const getSystemProxy = async () => {
    try {
      return await invoke<SystemProxyConfig | null>("get_system_proxy");
    } catch (e) {
      console.warn("Read system proxy failed, using updater defaults:", e);
      return null;
    }
  };

  const handleCancelCheck = useCallback(() => {
    checkCancelledRef.current = true;
    setUpdateStatus("idle");
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    if (updateStatus === "checking" || updateStatus === "downloading") return;
    checkCancelledRef.current = false;
    setUpdateStatus("checking");
    setErrorMsg("");
    try {
      let update: Update | null = null;
      const systemProxy = await getSystemProxy();
      if (systemProxy?.url) {
        try {
          update = await checkWithOptions(
            { proxy: systemProxy.url, timeout: UPDATE_CHECK_TIMEOUT },
            "system-proxy",
          );
        } catch (proxyError) {
          console.warn("System proxy update check failed, falling back to updater defaults:", proxyError);
          update = await checkWithOptions({ timeout: UPDATE_CHECK_TIMEOUT }, "default");
        }
      } else {
        update = await checkWithOptions({ timeout: UPDATE_CHECK_TIMEOUT }, "default");
      }

      if (checkCancelledRef.current) return;
      if (update) {
        updateRef.current = update;
        setLatestVersion(update.version);
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
    const update = updateRef.current;
    if (!update) return;
    try {
      setUpdateStatus("downloading");
      setDownloadProgress(0);
      setDownloadedSize(0);
      setTotalSize(0);
      let nextTotalSize = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          nextTotalSize = event.data.contentLength ?? 0;
          setTotalSize(nextTotalSize);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setDownloadedSize(downloaded);
          if (nextTotalSize > 0) {
            setDownloadProgress(Math.round((downloaded / nextTotalSize) * 100));
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      }, { timeout: UPDATE_DOWNLOAD_TIMEOUT });
      setUpdateStatus("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setUpdateStatus("error");
      setErrorMsg(msg);
      setTimeout(() => setUpdateStatus("idle"), 5000);
    }
  }, []);

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
            v{latestVersion} available{updateNetwork === "system-proxy" ? " via system proxy" : ""}{" · "}
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
            {downloadedSize > 0 && (
              <>
                {" "}
                ({formatSize(downloadedSize)}
                {totalSize > 0 ? `/${formatSize(totalSize)}` : ""})
              </>
            )}
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
        return <span className="text-[var(--accent-red)]" title={errorMsg}>Update failed: {errorMsg.slice(0, 60)}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)] relative">
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
          {usageStats && (usageStats.today_messages > 0 || usageStats.today_sessions > 0) && (
            <span
              className="text-[var(--text-muted)]"
              title={`今日: ${usageStats.today_messages} 消息 / ${usageStats.today_sessions} 会话 / ${usageStats.today_tool_calls} 工具调用`}
            >
              {usageStats.today_messages} msgs · {usageStats.today_tool_calls} tools
            </span>
          )}
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
