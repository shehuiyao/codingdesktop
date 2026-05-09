import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type ProjectStatus = "dirty" | "need_pull" | "need_push" | "no_remote" | "on_default" | "clean" | "error";
type FilterKey = "all" | ProjectStatus;

interface ProjectBranchStatus {
  name: string;
  path: string;
  branch: string;
  dirty_files: number;
  staged_files: number;
  unstaged_files: number;
  untracked_files: number;
  additions: number;
  deletions: number;
  ahead: number | null;
  behind: number | null;
  has_upstream: boolean;
  last_commit_at: string;
  last_commit_message: string;
  status: ProjectStatus;
  next_action: string;
  error: string | null;
}

interface ProjectBranchScan {
  root: string;
  projects: ProjectBranchStatus[];
}

interface ProjectBoardPanelProps {
  onOpenProject: (projectPath: string) => void;
}

const STORAGE_KEY = "coding-desktop-project-board-root";

const STATUS_META: Record<ProjectStatus, { label: string; className: string; dot: string }> = {
  dirty: {
    label: "待提交",
    className: "border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/10 text-[var(--accent-orange)]",
    dot: "bg-[var(--accent-orange)]",
  },
  need_pull: {
    label: "需同步",
    className: "border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)]",
    dot: "bg-[var(--accent-red)]",
  },
  need_push: {
    label: "待推送",
    className: "border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]",
    dot: "bg-[var(--accent-blue)]",
  },
  no_remote: {
    label: "未绑定远端",
    className: "border-[var(--accent-purple)]/30 bg-[var(--accent-purple)]/10 text-[var(--accent-purple)]",
    dot: "bg-[var(--accent-purple)]",
  },
  on_default: {
    label: "默认分支",
    className: "border-[var(--text-muted)]/40 bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
    dot: "bg-[var(--text-secondary)]",
  },
  clean: {
    label: "已干净",
    className: "border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]",
    dot: "bg-[var(--accent-green)]",
  },
  error: {
    label: "读取失败",
    className: "border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)]",
    dot: "bg-[var(--accent-red)]",
  },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部项目" },
  { key: "dirty", label: "待提交" },
  { key: "need_push", label: "待推送" },
  { key: "need_pull", label: "需同步" },
  { key: "clean", label: "已干净" },
];

function loadSavedRoot() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function formatPath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function formatCommitTime(value: string) {
  if (!value) return "暂无提交";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function countByStatus(projects: ProjectBranchStatus[], status: ProjectStatus) {
  return projects.filter((project) => project.status === status).length;
}

function statusClassName(status: ProjectStatus) {
  return STATUS_META[status]?.className ?? STATUS_META.error.className;
}

function statusLabel(status: ProjectStatus) {
  return STATUS_META[status]?.label ?? "未知";
}

function statusDot(status: ProjectStatus) {
  return STATUS_META[status]?.dot ?? STATUS_META.error.dot;
}

function ProjectMetric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--launchpad-card-bg)] p-4">
      <div className="text-2xl font-bold text-[var(--text-primary)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--text-secondary)]">{label}</div>
    </div>
  );
}

function ProjectCard({ project, onOpenProject }: { project: ProjectBranchStatus; onOpenProject: (path: string) => void }) {
  const ahead = project.ahead ?? 0;
  const behind = project.behind ?? 0;

  return (
    <article className="rounded-2xl border border-[var(--border-color)] bg-[var(--launchpad-card-bg)] p-4 shadow-lg shadow-[var(--shadow-color)]/10">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-[var(--text-primary)]">{project.name}</div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]" title={project.path}>
            {formatPath(project.path)}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${statusClassName(project.status)}`}>
          {statusLabel(project.status)}
        </span>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 font-mono text-xs text-[var(--accent-cyan)]">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(project.status)}`} />
        <span className="truncate">{project.branch}</span>
      </div>

      <div className="my-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-white/[0.03] p-2">
          <div className="text-xs font-semibold text-[var(--text-primary)]">{project.dirty_files}</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">改动文件</div>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-2">
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            {ahead}/{behind}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">领先/落后</div>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-2">
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            +{project.additions} -{project.deletions}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">代码变化</div>
        </div>
      </div>

      <div className="mb-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70 px-3 py-2">
        <div className="truncate text-xs text-[var(--text-primary)]" title={project.last_commit_message || project.error || ""}>
          {project.error ?? project.last_commit_message ?? "暂无提交信息"}
        </div>
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">{formatCommitTime(project.last_commit_at)}</div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-color)] pt-3">
        <div className="min-w-0 text-xs text-[var(--text-secondary)]">
          <span className="text-[var(--text-primary)]">下一步：</span>
          <span>{project.next_action}</span>
        </div>
        <button
          onClick={() => onOpenProject(project.path)}
          className="shrink-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)]"
        >
          打开
        </button>
      </div>
    </article>
  );
}

export default function ProjectBoardPanel({ onOpenProject }: ProjectBoardPanelProps) {
  const [root, setRoot] = useState(loadSavedRoot);
  const [projects, setProjects] = useState<ProjectBranchStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastScannedAt, setLastScannedAt] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const scanRoot = useCallback(async (nextRoot: string) => {
    if (!nextRoot) return;
    setLoading(true);
    setError("");
    try {
      const result = await invoke<ProjectBranchScan>("scan_project_branches", { root: nextRoot });
      setRoot(result.root);
      setProjects(result.projects);
      setLastScannedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      localStorage.setItem(STORAGE_KEY, result.root);
    } catch (err) {
      setError(String(err));
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (root) {
      scanRoot(root);
    }
  }, [root, scanRoot]);

  const handleChooseRoot = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择项目总文件夹",
    });
    if (selected && typeof selected === "string") {
      await scanRoot(selected);
    }
  }, [scanRoot]);

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return projects.filter((project) => {
      const statusMatched = activeFilter === "all" || project.status === activeFilter;
      const keywordMatched = !keyword
        || project.name.toLowerCase().includes(keyword)
        || project.path.toLowerCase().includes(keyword)
        || project.branch.toLowerCase().includes(keyword);
      return statusMatched && keywordMatched;
    });
  }, [activeFilter, projects, query]);

  const nextActions = useMemo(
    () => projects.filter((project) => project.status !== "clean").slice(0, 6),
    [projects],
  );

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(57,210,192,0.10),transparent_32%),var(--bg-primary)]">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">项目看板</h1>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                选择一个总文件夹，把里面项目的分支、改动和下一步集中摆出来。
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {root && (
                <span className="max-w-[360px] truncate rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-secondary)]" title={root}>
                  {formatPath(root)}
                </span>
              )}
              {lastScannedAt && (
                <span className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  上次扫描 {lastScannedAt}
                </span>
              )}
              <button
                onClick={handleChooseRoot}
                className="rounded-xl bg-[var(--accent-cyan)] px-3 py-2 text-xs font-semibold text-[#0d1117] transition-all hover:brightness-110"
              >
                选择文件夹
              </button>
              <button
                onClick={() => scanRoot(root)}
                disabled={!root || loading}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "扫描中" : "刷新"}
              </button>
            </div>
          </div>
        </section>

        <div className="sticky top-0 z-20 my-4 flex flex-col gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/80 p-3 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setActiveFilter(filter.key)}
                className={`rounded-xl border px-3 py-2 text-xs transition-colors ${
                  activeFilter === filter.key
                    ? "border-[var(--accent-cyan)]/45 bg-[var(--accent-cyan)]/12 text-[var(--accent-cyan)]"
                    : "border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-9 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-cyan)] md:w-72"
            placeholder="搜索项目、路径或分支"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-4 py-3 text-xs text-[var(--accent-red)]">
            {error}
          </div>
        )}

        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProjectMetric value={projects.length} label="已识别项目" />
          <ProjectMetric value={countByStatus(projects, "dirty")} label="本地有改动" />
          <ProjectMetric value={countByStatus(projects, "need_push")} label="可以推送远端" />
          <ProjectMetric value={countByStatus(projects, "need_pull")} label="需要先同步" />
        </div>

        {!root && (
          <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)]/55 px-6 text-center">
            <div>
              <div className="text-base font-semibold text-[var(--text-primary)]">先选择一个项目总文件夹</div>
              <div className="mt-2 max-w-md text-xs leading-6 text-[var(--text-secondary)]">
                比如选择 Desktop/sengo，看板会读取这一层里的 Git 项目，并给每个项目标出下一步。
              </div>
              <button
                onClick={handleChooseRoot}
                className="mt-5 rounded-xl bg-[var(--accent-cyan)] px-4 py-2 text-xs font-semibold text-[#0d1117] transition-all hover:brightness-110"
              >
                选择文件夹
              </button>
            </div>
          </div>
        )}

        {root && !loading && projects.length === 0 && !error && (
          <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)]/55 px-6 text-center">
            <div>
              <div className="text-base font-semibold text-[var(--text-primary)]">这个文件夹里暂时没扫到 Git 项目</div>
              <div className="mt-2 text-xs text-[var(--text-secondary)]">可以换一个上级目录，或者确认项目文件夹里有 .git。</div>
            </div>
          </div>
        )}

        {root && projects.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <section className="min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/55 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">项目状态</h2>
                <span className="text-xs text-[var(--text-muted)]">{filteredProjects.length} 个项目</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {filteredProjects.map((project) => (
                  <ProjectCard key={project.path} project={project} onOpenProject={onOpenProject} />
                ))}
              </div>
              {filteredProjects.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[var(--border-color)] py-12 text-center text-xs text-[var(--text-secondary)]">
                  当前筛选下没有项目。
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/55 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">下一步队列</h2>
                <span className="text-xs text-[var(--text-muted)]">按风险排序</span>
              </div>
              <div className="space-y-2">
                {nextActions.map((project) => (
                  <button
                    key={project.path}
                    onClick={() => onOpenProject(project.path)}
                    className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--launchpad-card-bg)] p-3 text-left transition-colors hover:border-[var(--accent-cyan)]"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{project.name}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClassName(project.status)}`}>
                        {statusLabel(project.status)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-[var(--text-secondary)]">{project.next_action}</div>
                    <div className="mt-2 truncate font-mono text-[10px] text-[var(--text-muted)]">{project.branch}</div>
                  </button>
                ))}
                {nextActions.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[var(--border-color)] px-4 py-10 text-center text-xs text-[var(--text-secondary)]">
                    当前没有明显待处理项。
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
