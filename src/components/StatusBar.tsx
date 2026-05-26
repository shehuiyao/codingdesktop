import { useState, useCallback, useRef, useEffect } from "react";
import { check, type CheckOptions, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../hooks/useTheme";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "update-available" | "downloading" | "done" | "error";
type UpdateNetwork = "system-proxy" | "default";
type VerifyCodeStatus = "idle" | "loading" | "ready" | "empty" | "error";
type SystemProxyConfig = {
  url: string;
  source: string;
};
type RedisVerifyCode = {
  key: string;
  scene: string;
  phone: string;
  code: string;
  ttl_seconds: number;
};

const APP_VERSION = "0.9.29";
const UPDATE_CHECK_TIMEOUT = 45000;
const UPDATE_DOWNLOAD_TIMEOUT = 10 * 60 * 1000;
const VERIFY_CODE_REFRESH_INTERVAL = 12000;

function maskPhone(phone: string) {
  if (!phone) return "未知号码";
  if (phone.length < 8) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function formatTtl(seconds: number) {
  if (seconds < 0) return "不过期";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function StatusBar() {
  const { mode, setMode } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedSize, setDownloadedSize] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [updateNetwork, setUpdateNetwork] = useState<UpdateNetwork>("default");
  const [errorMsg, setErrorMsg] = useState("");
  const [verifyCodes, setVerifyCodes] = useState<RedisVerifyCode[]>([]);
  const [verifyCodeStatus, setVerifyCodeStatus] = useState<VerifyCodeStatus>("idle");
  const [verifyCodeError, setVerifyCodeError] = useState("");
  const [showVerifyCodePanel, setShowVerifyCodePanel] = useState(false);
  const [copiedVerifyCode, setCopiedVerifyCode] = useState("");
  const updateRef = useRef<Update | null>(null);
  const checkCancelledRef = useRef(false);
  const verifyCodePanelRef = useRef<HTMLDivElement>(null);

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

  const getErrorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const formatCheckFailure = (label: string, e: unknown) => `${label}: ${getErrorMessage(e)}`;

  const fetchVerifyCodes = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setVerifyCodeStatus("loading");
    }
    try {
      const codes = await invoke<RedisVerifyCode[]>("get_redis_verify_codes", {
        host: "127.0.0.1",
        port: 6381,
        db: 0,
      });
      setVerifyCodes(codes);
      setVerifyCodeError("");
      setVerifyCodeStatus(codes.length > 0 ? "ready" : "empty");
    } catch (e: unknown) {
      setVerifyCodes([]);
      setVerifyCodeStatus("error");
      setVerifyCodeError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    fetchVerifyCodes();
    const interval = setInterval(() => fetchVerifyCodes(false), VERIFY_CODE_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchVerifyCodes]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!verifyCodePanelRef.current?.contains(event.target as Node)) {
        setShowVerifyCodePanel(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const copyVerifyCode = useCallback((code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedVerifyCode(code);
    setTimeout(() => setCopiedVerifyCode(""), 1500);
  }, []);

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
          try {
            update = await checkWithOptions({ timeout: UPDATE_CHECK_TIMEOUT }, "default");
          } catch (defaultError) {
            throw new Error([
              formatCheckFailure(`系统代理失败（${systemProxy.source} ${systemProxy.url}）`, proxyError),
              formatCheckFailure("直连失败", defaultError),
            ].join("；"));
          }
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
      const msg = getErrorMessage(e);
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
      const msg = getErrorMessage(e);
      setUpdateStatus("error");
      setErrorMsg(`下载失败（${updateNetwork === "system-proxy" ? "系统代理链路" : "默认链路"}）: ${msg}`);
      setTimeout(() => setUpdateStatus("idle"), 5000);
    }
  }, [updateNetwork]);

  const handleRelaunch = useCallback(async () => {
    await relaunch();
  }, []);

  const latestVerifyCode = verifyCodes[0] ?? null;
  const verifyCodeButtonText =
    verifyCodeStatus === "loading"
      ? "验证码 ..."
      : latestVerifyCode
        ? `验证码 ${latestVerifyCode.code}`
        : "验证码 --";

  const renderVerifyCodePanel = () => (
    <div className="absolute bottom-6 right-0 z-50 w-72 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/98 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
        <div>
          <div className="text-xs font-medium text-[var(--text-primary)]">Redis 验证码</div>
          <div className="text-[10px] text-[var(--text-muted)]">127.0.0.1:6381 / DB 0</div>
        </div>
        <button
          onClick={() => fetchVerifyCodes()}
          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-hover)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)]"
        >
          刷新
        </button>
      </div>

      <div className="max-h-64 overflow-auto p-2">
        {verifyCodeStatus === "loading" && (
          <div className="px-2 py-4 text-center text-[10px] text-[var(--text-muted)]">正在读 Redis...</div>
        )}
        {verifyCodeStatus === "error" && (
          <div className="rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-2 py-2 text-[10px] text-[var(--accent-red)]" title={verifyCodeError}>
            Redis 暂时读不到：{verifyCodeError.slice(0, 90)}
          </div>
        )}
        {verifyCodeStatus === "empty" && (
          <div className="px-2 py-4 text-center text-[10px] text-[var(--text-muted)]">
            暂时没有 `pf_verify_code:*`
          </div>
        )}
        {verifyCodes.map((item) => (
          <button
            key={item.key}
            onClick={() => copyVerifyCode(item.code)}
            className="mb-1 flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]"
            title={`${item.key}，点击复制验证码`}
          >
            <span className="min-w-0">
              <span className="block truncate text-[11px] text-[var(--text-secondary)]">
                {item.scene || "verify"} · {maskPhone(item.phone)}
              </span>
              <span className="block truncate text-[10px] text-[var(--text-muted)]">
                剩余 {formatTtl(item.ttl_seconds)}
              </span>
            </span>
            <span className="shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-sm text-[var(--accent-cyan)]">
              {copiedVerifyCode === item.code ? "已复制" : item.code}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

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
    <div className="relative min-w-0 flex-1 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]">
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-0.5 text-[10px]">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap">
          <span className="shrink-0 text-[var(--text-muted)]">v{APP_VERSION}</span>
          <button
            onClick={handleCheckUpdate}
            disabled={updateStatus === "checking" || updateStatus === "downloading"}
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer transition-colors duration-150 bg-transparent border-none p-0 text-[10px] disabled:opacity-50 disabled:cursor-default"
          >
            Check for Updates
          </button>
          <span className="min-w-0 truncate">{renderUpdateContent()}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div ref={verifyCodePanelRef} className="relative">
            <button
              onClick={() => {
                setShowVerifyCodePanel((visible) => !visible);
                fetchVerifyCodes();
              }}
              className={`rounded-lg border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                latestVerifyCode
                  ? "border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:border-[var(--accent-cyan)]"
                  : "border-[var(--border-color)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
              title={latestVerifyCode ? `点击查看/复制 ${latestVerifyCode.key}` : "点击读取 Redis 验证码"}
            >
              {verifyCodeButtonText}
            </button>
            {showVerifyCodePanel && renderVerifyCodePanel()}
          </div>
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
