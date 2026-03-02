import { useState, useCallback, useRef, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../hooks/useTheme";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "update-available" | "downloading" | "done" | "error";

const APP_VERSION = "0.8.2";

export default function StatusBar() {
  const { mode, setMode } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
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

  // 反馈系统状态
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);

  const handleSubmitFeedback = useCallback(async () => {
    if (!feedbackText.trim()) return;
    setFeedbackSubmitting(true);
    try {
      await invoke("submit_feedback", { content: feedbackText.trim() });
      setFeedbackDone(true);
      setFeedbackText("");
      setTimeout(() => {
        setShowFeedback(false);
        setFeedbackDone(false);
      }, 1500);
    } catch {
      // 静默失败
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [feedbackText]);

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
      // 不设前端超时，由用户手动 Cancel；网络慢时给足时间
      const update = await check();
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
      let totalSize = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalSize = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalSize > 0) {
            setDownloadProgress(Math.round((downloaded / totalSize) * 100));
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      });
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
            onClick={() => setShowFeedback(!showFeedback)}
            className={`cursor-pointer transition-colors duration-150 bg-transparent border-none p-0 text-[10px] ${
              showFeedback ? "text-[var(--accent-cyan)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            title="提交反馈"
          >
            Feedback
          </button>
          <button
            onClick={cycleTheme}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer transition-colors duration-150 bg-transparent border-none p-0 text-[10px]"
            title={`Theme: ${mode} (click to cycle)`}
          >
            {themeLabel}
          </button>
        </div>
      </div>

      {/* 反馈弹窗 */}
      {showFeedback && (
        <div className="absolute bottom-full right-0 mb-1 w-72 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-lg p-3 z-50">
          {feedbackDone ? (
            <div className="text-xs text-[var(--accent-green)] text-center py-2">
              感谢反馈！
            </div>
          ) : (
            <>
              <div className="text-xs text-[var(--text-primary)] mb-2 font-medium">提交反馈</div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="描述你遇到的问题或建议..."
                className="w-full h-20 text-xs bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-md p-2 resize-none outline-none focus:border-[var(--accent-cyan)] placeholder:text-[var(--text-muted)]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.metaKey) handleSubmitFeedback();
                  if (e.key === "Escape") setShowFeedback(false);
                }}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-[var(--text-muted)]">⌘Enter 提交</span>
                <button
                  onClick={handleSubmitFeedback}
                  disabled={!feedbackText.trim() || feedbackSubmitting}
                  className="px-3 py-1 text-[10px] rounded-md bg-[var(--accent-cyan)] text-[#0d1117] hover:brightness-110 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-default"
                >
                  {feedbackSubmitting ? "提交中..." : "提交"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
