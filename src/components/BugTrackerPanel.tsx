import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface BugEntry {
  id: string;
  title: string;
  description: string;
  reporter: string;
  priority: string;
  status: string;
  images: string[];
  fix_commit: string | null;
  created: string;
  updated: string;
}

interface BugsData {
  project: string;
  branch: string;
  created: string;
  bugs: BugEntry[];
}

interface BugTrackerPanelProps {
  workingDir: string;
  onClose: () => void;
}

const STATUS_MAP: Record<string, string> = {
  pending: "待修复",
  fixing: "修复中",
  fixed: "已修复",
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "text-[var(--accent-red)] bg-[var(--accent-red)]/10",
  P1: "text-[var(--accent-orange)] bg-[var(--accent-orange)]/10",
  P2: "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10",
  P3: "text-[var(--text-secondary)] bg-[var(--bg-tertiary)]",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-[var(--accent-red)]",
  fixing: "text-[var(--accent-orange)]",
  fixed: "text-[var(--accent-green)]",
};

const STATUS_DOT_COLORS: Record<string, string> = {
  pending: "bg-[var(--accent-red)]",
  fixing: "bg-[var(--accent-orange)]",
  fixed: "bg-[var(--accent-green)]",
};

type FilterType = "all" | "pending" | "fixing" | "fixed";

export default function BugTrackerPanel({ workingDir, onClose }: BugTrackerPanelProps) {
  const [bugsData, setBugsData] = useState<BugsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedBug, setExpandedBug] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const loadBugs = useCallback(() => {
    invoke<BugsData>("list_bugs", { workingDir })
      .then((data) => {
        setBugsData(data);
        setError(null);
      })
      .catch((err) => {
        setError(String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [workingDir]);

  useEffect(() => {
    loadBugs();
    const timer = setInterval(loadBugs, 5000);
    return () => clearInterval(timer);
  }, [loadBugs]);

  const handleStatusChange = useCallback(
    (bugId: string, newStatus: string) => {
      invoke<BugEntry>("update_bug_status", {
        workingDir,
        bugId,
        newStatus,
      })
        .then(() => {
          loadBugs();
        })
        .catch((err) => {
          setError(String(err));
        });
    },
    [workingDir, loadBugs]
  );

  const handlePriorityChange = useCallback(
    (bugId: string, newPriority: string) => {
      invoke<BugEntry>("update_bug_priority", {
        workingDir,
        bugId,
        newPriority,
      })
        .then(() => {
          loadBugs();
        })
        .catch((err) => {
          setError(String(err));
        });
    },
    [workingDir, loadBugs]
  );

  const stats = bugsData
    ? {
        total: bugsData.bugs.length,
        pending: bugsData.bugs.filter((b) => b.status === "pending").length,
        fixing: bugsData.bugs.filter((b) => b.status === "fixing").length,
        fixed: bugsData.bugs.filter((b) => b.status === "fixed").length,
      }
    : { total: 0, pending: 0, fixing: 0, fixed: 0 };

  const filteredBugs = bugsData
    ? filter === "all"
      ? bugsData.bugs
      : bugsData.bugs.filter((b) => b.status === filter)
    : [];

  return (
    <div className="w-72 border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex flex-col h-full overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
            Bugs
          </span>
          {bugsData?.branch && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-purple)]/20 text-[var(--accent-purple)] truncate max-w-[120px]">
              {bugsData.branch}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150 text-[10px]"
          title="关闭"
        >
          ✕
        </button>
      </div>

      {/* 统计栏 */}
      {stats.total > 0 && (
        <div className="flex gap-1 px-3 py-2 border-b border-[var(--border-subtle)] shrink-0">
          <div className="flex-1 text-center">
            <div className="text-base font-bold text-[var(--accent-purple)]">{stats.total}</div>
            <div className="text-[10px] text-[var(--text-muted)]">总计</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-base font-bold text-[var(--accent-red)]">{stats.pending}</div>
            <div className="text-[10px] text-[var(--text-muted)]">待修复</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-base font-bold text-[var(--accent-orange)]">{stats.fixing}</div>
            <div className="text-[10px] text-[var(--text-muted)]">修复中</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-base font-bold text-[var(--accent-green)]">{stats.fixed}</div>
            <div className="text-[10px] text-[var(--text-muted)]">已修复</div>
          </div>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-[var(--border-subtle)] shrink-0">
        {(["all", "pending", "fixing", "fixed"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors duration-150 cursor-pointer ${
              filter === f
                ? "bg-[var(--bg-hover,#3f3f46)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            {f === "all" ? "全部" : STATUS_MAP[f]}
          </button>
        ))}
      </div>

      {/* Bug 列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center py-8 text-[var(--text-muted)] text-xs">
            加载中...
          </div>
        ) : error ? (
          <div className="text-center py-8 px-3">
            <div className="text-[var(--accent-red)] text-xs">{error}</div>
            <button
              onClick={loadBugs}
              className="mt-2 text-[10px] text-[var(--accent-cyan)] hover:underline cursor-pointer"
            >
              重试
            </button>
          </div>
        ) : filteredBugs.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-muted)] text-xs">
            {stats.total === 0 ? "暂无 Bug 数据" : "没有匹配的 Bug"}
          </div>
        ) : (
          filteredBugs.map((bug) => (
            <BugCard
              key={bug.id}
              bug={bug}
              expanded={expandedBug === bug.id}
              onToggle={() =>
                setExpandedBug(expandedBug === bug.id ? null : bug.id)
              }
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
              workingDir={workingDir}
              onPreviewImage={setPreviewImage}
            />
          ))
        )}
      </div>

      {/* 图片预览弹层 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[80vw] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewImage}
              alt="Bug 截图预览"
              className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Bug 卡片子组件 */
function BugCard({
  bug,
  expanded,
  onToggle,
  onStatusChange,
  onPriorityChange,
  workingDir,
  onPreviewImage,
}: {
  bug: BugEntry;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (bugId: string, newStatus: string) => void;
  onPriorityChange: (bugId: string, newPriority: string) => void;
  workingDir: string;
  onPreviewImage: (dataUri: string) => void;
}) {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);

  useEffect(() => {
    if (!expanded || bug.images.length === 0) {
      setThumbnails([]);
      return;
    }
    setLoadingImages(true);
    Promise.all(
      bug.images.map((imgPath) =>
        invoke<string>("get_bug_image", { workingDir, imagePath: imgPath }).catch(() => "")
      )
    ).then((results) => {
      setThumbnails(results.filter(Boolean));
      setLoadingImages(false);
    });
  }, [expanded, bug.images, workingDir]);
  return (
    <div
      className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors duration-100 cursor-pointer"
      onClick={onToggle}
    >
      {/* 摘要行 */}
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {bug.id}
              </span>
              <span className="relative">
                <button
                  className={`text-[10px] px-1 py-0.5 rounded font-semibold cursor-pointer hover:ring-1 hover:ring-current transition-all duration-150 ${
                    PRIORITY_COLORS[bug.priority] || ""
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPriorityMenu(!showPriorityMenu);
                  }}
                  title="点击切换优先级"
                >
                  {bug.priority}
                </button>
                {showPriorityMenu && (
                  <div
                    className="absolute top-full left-0 mt-1 z-20 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded shadow-lg py-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {["P0", "P1", "P2", "P3"].map((p) => (
                      <button
                        key={p}
                        className={`block w-full text-left text-[10px] px-3 py-1 cursor-pointer transition-colors duration-100 ${
                          p === bug.priority
                            ? "bg-[var(--bg-hover)] font-bold"
                            : "hover:bg-[var(--bg-hover)]"
                        } ${PRIORITY_COLORS[p] || ""}`}
                        onClick={() => {
                          if (p !== bug.priority) {
                            onPriorityChange(bug.id, p);
                          }
                          setShowPriorityMenu(false);
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            </div>
            <div className="text-xs text-[var(--text-primary)] mt-0.5 truncate">
              {bug.title}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 mt-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                STATUS_DOT_COLORS[bug.status] || ""
              }`}
            />
            <span
              className={`text-[10px] font-medium ${
                STATUS_COLORS[bug.status] || ""
              }`}
            >
              {STATUS_MAP[bug.status] || bug.status}
            </span>
          </div>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div
          className="px-3 pb-3 border-t border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[11px] leading-relaxed text-[var(--text-secondary)] mt-2">
            {bug.description}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-[var(--text-muted)]">
            {bug.reporter && <span>反馈: {bug.reporter}</span>}
            {bug.created && <span>创建: {bug.created}</span>}
            {bug.fix_commit && (
              <span className="font-mono">
                commit: {bug.fix_commit.substring(0, 7)}
              </span>
            )}
          </div>

          {bug.images.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-[var(--text-muted)] mb-1">
                {bug.images.length} 张截图
              </div>
              {loadingImages ? (
                <div className="text-[10px] text-[var(--text-muted)]">加载中...</div>
              ) : (
                <div className="flex gap-1.5 flex-wrap">
                  {thumbnails.map((dataUri, idx) => (
                    <img
                      key={idx}
                      src={dataUri}
                      alt={`${bug.id} 截图 ${idx + 1}`}
                      className="w-20 h-14 object-cover rounded border border-[var(--border-subtle)] cursor-pointer hover:border-[var(--accent-cyan)] hover:opacity-90 transition-all duration-150"
                      onClick={() => onPreviewImage(dataUri)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-1 mt-2">
            {bug.status !== "pending" && (
              <button
                onClick={() => onStatusChange(bug.id, "pending")}
                className="text-[10px] px-2 py-1 rounded bg-[var(--accent-red)]/10 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/20 transition-colors duration-150 cursor-pointer"
              >
                待修复
              </button>
            )}
            {bug.status !== "fixing" && (
              <button
                onClick={() => onStatusChange(bug.id, "fixing")}
                className="text-[10px] px-2 py-1 rounded bg-[var(--accent-orange)]/10 text-[var(--accent-orange)] hover:bg-[var(--accent-orange)]/20 transition-colors duration-150 cursor-pointer"
              >
                修复中
              </button>
            )}
            {bug.status !== "fixed" && (
              <button
                onClick={() => onStatusChange(bug.id, "fixed")}
                className="text-[10px] px-2 py-1 rounded bg-[var(--accent-green)]/10 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/20 transition-colors duration-150 cursor-pointer"
              >
                已修复
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
