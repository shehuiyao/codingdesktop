import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import LiveTerminal from "./LiveTerminal";

interface LaunchpadProject {
  id: string;
  name: string;
  workingDir: string;
  startCommand: string;
  groupId: string;
}

interface LaunchpadGroup {
  id: string;
  name: string;
}

interface LaunchpadData {
  groups: LaunchpadGroup[];
  projects: LaunchpadProject[];
  activeGroupId: string;
}

type ProjectRuntimeStatus = "idle" | "starting" | "running" | "detected" | "stopped" | "error";

interface ProjectRuntimeState {
  status: ProjectRuntimeStatus;
  runKey: number;
  expanded: boolean;
  lastError: string;
}

interface DetectedRunningProject {
  project_id: string;
  name: string;
  working_dir: string;
  pid: number;
  command: string;
  port?: string | null;
}

const STORAGE_KEY = "claude-desktop-launchpad-projects";
const DEFAULT_GROUP_NAME = "默认分组";

function isActiveRuntimeStatus(status: ProjectRuntimeStatus) {
  return status === "starting" || status === "running" || status === "detected";
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `launch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createGroup(seed?: Partial<LaunchpadGroup>): LaunchpadGroup {
  return {
    id: createId(),
    name: DEFAULT_GROUP_NAME,
    ...seed,
  };
}

function createProject(seed?: Partial<LaunchpadProject>, groupId = ""): LaunchpadProject {
  return {
    id: createId(),
    name: "",
    workingDir: "",
    startCommand: "npm run dev",
    groupId,
    ...seed,
  };
}

function getProjectName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function normalizeLaunchpadData(value: unknown): LaunchpadData {
  const fallbackGroup = createGroup();
  if (Array.isArray(value)) {
    const projects = value
      .filter((item): item is Partial<LaunchpadProject> => !!item && typeof item === "object")
      .map((item) => createProject(item, fallbackGroup.id));

    return {
      groups: [fallbackGroup],
      projects,
      activeGroupId: fallbackGroup.id,
    };
  }

  if (!value || typeof value !== "object") {
    return {
      groups: [fallbackGroup],
      projects: [],
      activeGroupId: fallbackGroup.id,
    };
  }

  const data = value as Record<string, unknown>;
  const groups = Array.isArray(data.groups)
    ? data.groups
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item, index) =>
          createGroup({
            id: typeof item.id === "string" && item.id ? item.id : createId(),
            name: typeof item.name === "string" && item.name.trim() ? item.name : `${DEFAULT_GROUP_NAME} ${index + 1}`,
          }),
        )
    : [];

  const safeGroups = groups.length > 0 ? groups : [fallbackGroup];
  const firstGroupId = safeGroups[0].id;
  const groupIds = new Set(safeGroups.map((group) => group.id));
  const projects = Array.isArray(data.projects)
    ? data.projects
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => {
          const groupId = typeof item.groupId === "string" && groupIds.has(item.groupId) ? item.groupId : firstGroupId;
          return createProject(item, groupId);
        })
    : [];

  const activeGroupId = typeof data.activeGroupId === "string" && groupIds.has(data.activeGroupId)
    ? data.activeGroupId
    : firstGroupId;

  return {
    groups: safeGroups,
    projects,
    activeGroupId,
  };
}

function loadLaunchpadData(): LaunchpadData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeLaunchpadData(null);
    const parsed = JSON.parse(raw);
    return normalizeLaunchpadData(parsed);
  } catch {
    return normalizeLaunchpadData(null);
  }
}

function emptyRuntime(): ProjectRuntimeState {
  return {
    status: "idle",
    runKey: 0,
    expanded: false,
    lastError: "",
  };
}

function statusText(status: ProjectRuntimeStatus) {
  switch (status) {
    case "starting":
      return "启动中";
    case "running":
      return "运行中";
    case "detected":
      return "系统运行";
    case "error":
      return "异常";
    case "stopped":
      return "已停止";
    default:
      return "待启动";
  }
}

function statusClassName(status: ProjectRuntimeStatus) {
  switch (status) {
    case "starting":
      return "text-[var(--accent-orange)] bg-[var(--accent-orange)]/12 border-[var(--accent-orange)]/30";
    case "running":
    case "detected":
      return "text-[var(--accent-green)] bg-[var(--accent-green)]/12 border-[var(--accent-green)]/30";
    case "error":
      return "text-[var(--accent-red)] bg-[var(--accent-red)]/12 border-[var(--accent-red)]/30";
    case "stopped":
      return "text-[var(--accent-blue)] bg-[var(--accent-blue)]/12 border-[var(--accent-blue)]/30";
    default:
      return "text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-[var(--border-color)]";
  }
}

export default function LaunchpadPanel() {
  const [launchpadData, setLaunchpadData] = useState<LaunchpadData>(loadLaunchpadData);
  const [runtime, setRuntime] = useState<Record<string, ProjectRuntimeState>>({});
  const [detectedProjects, setDetectedProjects] = useState<DetectedRunningProject[]>([]);
  const [detectingProjects, setDetectingProjects] = useState(false);
  const [detectError, setDetectError] = useState("");
  const { groups, projects, activeGroupId } = launchpadData;
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0];
  const activeGroupProjects = useMemo(
    () => projects.filter((project) => project.groupId === activeGroup.id),
    [activeGroup.id, projects],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(launchpadData));
  }, [launchpadData]);

  const runningCount = Object.values(runtime).filter((item) => isActiveRuntimeStatus(item.status)).length;

  const updateProject = (id: string, patch: Partial<LaunchpadProject>) => {
    setLaunchpadData((prev) => ({
      ...prev,
      projects: prev.projects.map((project) => (project.id === id ? { ...project, ...patch } : project)),
    }));
  };

  const addProject = () => {
    setLaunchpadData((prev) => ({
      ...prev,
      projects: [...prev.projects, createProject({ groupId: prev.activeGroupId }, prev.activeGroupId)],
    }));
  };

  const addGroup = () => {
    setLaunchpadData((prev) => {
      const group = createGroup({ name: `分组 ${prev.groups.length + 1}` });
      return {
        ...prev,
        groups: [...prev.groups, group],
        activeGroupId: group.id,
      };
    });
  };

  const updateGroup = (id: string, patch: Partial<LaunchpadGroup>) => {
    setLaunchpadData((prev) => ({
      ...prev,
      groups: prev.groups.map((group) => (group.id === id ? { ...group, ...patch } : group)),
    }));
  };

  const removeGroup = (id: string) => {
    setLaunchpadData((prev) => {
      if (prev.groups.length <= 1) return prev;

      const group = prev.groups.find((item) => item.id === id);
      if (!group) return prev;

      const nextGroups = prev.groups.filter((item) => item.id !== id);
      const fallbackGroup = nextGroups[0];
      const groupProjects = prev.projects.filter((project) => project.groupId === id);

      if (groupProjects.length > 0) {
        const confirmed = window.confirm(
          `删除「${group.name || DEFAULT_GROUP_NAME}」后，里面的 ${groupProjects.length} 个项目会移动到「${fallbackGroup.name || DEFAULT_GROUP_NAME}」。继续吗？`,
        );
        if (!confirmed) return prev;
      }

      return {
        ...prev,
        groups: nextGroups,
        activeGroupId: prev.activeGroupId === id ? fallbackGroup.id : prev.activeGroupId,
        projects: prev.projects.map((project) =>
          project.groupId === id ? { ...project, groupId: fallbackGroup.id } : project,
        ),
      };
    });
  };

  const selectGroup = (id: string) => {
    setLaunchpadData((prev) => ({ ...prev, activeGroupId: id }));
  };

  const removeProject = (id: string) => {
    setLaunchpadData((prev) => ({
      ...prev,
      projects: prev.projects.filter((project) => project.id !== id),
    }));
    setRuntime((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setProjectRuntime = (
    id: string,
    updater: (current: ProjectRuntimeState) => ProjectRuntimeState,
  ) => {
    setRuntime((prev) => ({
      ...prev,
      [id]: updater(prev[id] ?? emptyRuntime()),
    }));
  };

  const pickWorkingDir = async (id: string) => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select project directory",
    });
    if (typeof selected !== "string") return;
    updateProject(id, ((): Partial<LaunchpadProject> => {
      const project = projects.find((item) => item.id === id);
      return {
        workingDir: selected,
        name: project?.name.trim() ? project.name : getProjectName(selected),
      };
    })());
  };

  const handleStart = (projectId: string) => {
    setProjectRuntime(projectId, (current) => ({
      ...current,
      status: "starting",
      runKey: current.runKey + 1,
      expanded: true,
      lastError: "",
    }));
  };

  const handleRestart = (projectId: string) => {
    setProjectRuntime(projectId, (current) => ({
      ...current,
      status: "starting",
      runKey: current.runKey + 1,
      expanded: true,
      lastError: "",
    }));
  };

  const handleStop = (projectId: string) => {
    setProjectRuntime(projectId, (current) => ({
      ...current,
      status: "stopped",
      expanded: false,
    }));
  };

  const handleDetectRunningProjects = async () => {
    setDetectingProjects(true);
    setDetectError("");
    try {
      const result = await invoke<DetectedRunningProject[]>("detect_running_launchpad_projects", {
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name || getProjectName(project.workingDir),
          working_dir: project.workingDir,
        })),
      });
      setDetectedProjects(result);
      const detectedIds = new Set(result.map((project) => project.project_id));
      setRuntime((prev) => {
        const next = { ...prev };
        for (const project of projects) {
          const current = next[project.id];
          if (current?.status === "starting" || current?.status === "running") {
            continue;
          }
          if (detectedIds.has(project.id)) {
            next[project.id] = {
              ...(current ?? emptyRuntime()),
              status: "detected",
              expanded: false,
              lastError: "",
            };
          } else if (current?.status === "detected") {
            next[project.id] = {
              ...current,
              status: "idle",
            };
          }
        }
        return next;
      });
    } catch (error) {
      setDetectedProjects([]);
      setDetectError(String(error));
    } finally {
      setDetectingProjects(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(57,210,192,0.09),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(88,166,255,0.08),transparent_24%)]">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-5 shadow-[0_18px_60px_var(--shadow-color)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-2xl font-semibold text-[var(--text-primary)]">
                前后端启动工作台
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                {projects.length} 个项目 · {groups.length} 个分组 · {runningCount} 个运行中
              </div>
              <button
                onClick={handleDetectRunningProjects}
                disabled={detectingProjects || projects.length === 0}
                className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-cyan)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {detectingProjects ? "检测中" : "检测运行"}
              </button>
              <button
                onClick={addProject}
                className="rounded-xl bg-[var(--accent-cyan)] px-4 py-2 text-sm font-medium text-[#0d1117] transition hover:brightness-110 active:brightness-95"
              >
                新增项目
              </button>
            </div>
          </div>
        </div>

        {(detectedProjects.length > 0 || detectError) && (
          <div className="mb-5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/78 p-4 shadow-[0_12px_36px_var(--shadow-color)] backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                系统运行检测
              </div>
              <button
                onClick={() => {
                  setDetectedProjects([]);
                  setDetectError("");
                }}
                className="rounded-xl border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
              >
                收起
              </button>
            </div>
            {detectError ? (
              <div className="rounded-xl border border-[var(--accent-red)]/25 bg-[var(--accent-red)]/10 px-3 py-2 text-xs text-[var(--accent-red)]">
                {detectError}
              </div>
            ) : (
              <div className="grid gap-2">
                {detectedProjects.map((project) => (
                  <div
                    key={`${project.project_id}-${project.pid}-${project.port ?? "unknown"}`}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                  >
                    <span className="font-medium text-[var(--text-primary)]">{project.name}</span>
                    {project.port && <span className="text-[var(--accent-green)]">端口 {project.port}</span>}
                    <span>PID {project.pid}</span>
                    <span className="truncate text-[var(--text-muted)]">{project.command}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mb-5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/78 p-3 shadow-[0_12px_36px_var(--shadow-color)] backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            {groups.map((group) => {
              const isActiveGroup = group.id === activeGroup.id;
              const groupProjects = projects.filter((project) => project.groupId === group.id);
              const groupRunningCount = groupProjects.filter((project) => {
                const state = runtime[project.id];
                return state ? isActiveRuntimeStatus(state.status) : false;
              }).length;

              return (
                <div
                  key={group.id}
                  onClick={() => selectGroup(group.id)}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                    isActiveGroup
                      ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 text-[var(--text-primary)]"
                      : "border-[var(--border-color)] bg-[var(--bg-primary)]/80 text-[var(--text-secondary)] hover:border-[var(--accent-cyan)]/60 hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-[var(--accent-cyan)]" />
                  <input
                    value={group.name}
                    onFocus={() => selectGroup(group.id)}
                    onChange={(event) => updateGroup(group.id, { name: event.target.value })}
                    className="w-24 border-none bg-transparent text-xs font-medium text-inherit outline-none placeholder:text-[var(--text-muted)]"
                    placeholder={DEFAULT_GROUP_NAME}
                  />
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {groupProjects.length} 项 · {groupRunningCount} 运行
                  </span>
                  {groups.length > 1 && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        removeGroup(group.id);
                      }}
                      className="ml-1 rounded-lg px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] transition hover:bg-[var(--accent-red)]/10 hover:text-[var(--accent-red)]"
                      title="删除分组"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={addGroup}
              className="rounded-xl border border-dashed border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)]"
            >
              + 新增分组
            </button>
          </div>

        </div>

        {projects.length === 0 ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)]/70 p-10 text-center">
            <div className="max-w-md">
              <div className="text-xl font-semibold text-[var(--text-primary)]">
                先加一个项目卡片
              </div>
              <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                适合把前端、后端、网关、脚本服务都放在同一个页面里统一管理。
              </div>
              <button
                onClick={addProject}
                className="mt-6 rounded-xl border border-[var(--accent-cyan)] px-4 py-2 text-sm font-medium text-[var(--accent-cyan)] transition hover:bg-[var(--accent-cyan)]/10"
              >
                创建第一个项目
              </button>
            </div>
          </div>
        ) : activeGroupProjects.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)]/70 p-10 text-center">
            <div className="max-w-md">
              <div className="text-xl font-semibold text-[var(--text-primary)]">
                这个分组还没有项目
              </div>
              <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                可以把一个 worktree 当成一个分组，里面放这一套环境要启动的前端、后端和脚本服务。
              </div>
              <button
                onClick={addProject}
                className="mt-6 rounded-xl border border-[var(--accent-cyan)] px-4 py-2 text-sm font-medium text-[var(--accent-cyan)] transition hover:bg-[var(--accent-cyan)]/10"
              >
                在当前分组新增项目
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-5">
            {activeGroupProjects.map((project) => {
              const state = runtime[project.id] ?? emptyRuntime();
              const isRunning = state.status === "starting" || state.status === "running";
              const isDetectedRunning = state.status === "detected";
              const canStart = project.workingDir.trim() !== "" && project.startCommand.trim() !== "";

              return (
                <div
                  key={project.id}
                  className="flex min-h-[420px] flex-col rounded-2xl border border-[var(--border-color)] bg-[linear-gradient(180deg,rgba(22,27,34,0.96),rgba(13,17,23,0.98))] shadow-[0_16px_45px_var(--shadow-color)]"
                >
                  <div className="border-b border-[var(--border-color)] px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <input
                          value={project.name}
                          onChange={(e) => updateProject(project.id, { name: e.target.value })}
                          className="w-full border-none bg-transparent text-base font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                          placeholder="项目名称，例如：收银台前端"
                        />
                        <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                          {project.workingDir || "还没设置目录"}
                        </div>
                      </div>
                      <span
                        className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusClassName(state.status)}`}
                      >
                        {statusText(state.status)}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => (isRunning ? handleStop(project.id) : handleStart(project.id))}
                        disabled={isDetectedRunning || (!isRunning && !canStart)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                          isRunning
                            ? "bg-[var(--accent-red)] text-white hover:brightness-110"
                            : "bg-[var(--accent-green)] text-[#08140d] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                        }`}
                      >
                        {isRunning ? "关闭" : isDetectedRunning ? "已在运行" : "启动"}
                      </button>
                      {isRunning && (
                        <button
                          onClick={() => handleRestart(project.id)}
                          className="rounded-lg border border-[var(--accent-cyan)]/45 px-3 py-1.5 text-xs text-[var(--accent-cyan)] transition hover:bg-[var(--accent-cyan)]/10 hover:text-[var(--text-primary)]"
                        >
                          重启
                        </button>
                      )}
                      <button
                        onClick={() => pickWorkingDir(project.id)}
                        className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--accent-cyan)] hover:text-[var(--text-primary)]"
                      >
                        选择目录
                      </button>
                      {state.expanded && !isRunning && (
                        <button
                          onClick={() =>
                            setProjectRuntime(project.id, (current) => ({ ...current, expanded: false }))
                          }
                          className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                        >
                          收起终端
                        </button>
                      )}
                      <button
                        onClick={() => removeProject(project.id)}
                        className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--accent-red)] hover:text-[var(--accent-red)]"
                      >
                        删除
                      </button>
                      {groups.length > 1 && (
                        <div className="relative inline-flex items-center">
                          <select
                            value={project.groupId}
                            onChange={(event) => updateProject(project.id, { groupId: event.target.value })}
                            className="h-9 appearance-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 pr-8 text-xs text-[var(--text-secondary)] outline-none transition hover:border-[var(--accent-cyan)] hover:text-[var(--text-primary)] focus:border-[var(--accent-cyan)] focus:text-[var(--text-primary)]"
                          >
                            {groups.map((group) => (
                              <option key={group.id} value={group.id} className="bg-[var(--bg-primary)] text-[var(--text-primary)]">
                                移到：{group.name || DEFAULT_GROUP_NAME}
                              </option>
                            ))}
                          </select>
                          <span className="pointer-events-none absolute right-3 text-[10px] text-[var(--text-muted)]">
                            ▾
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 px-4 py-4">
                    <label className="block">
                      <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                        Working Directory
                      </div>
                      <input
                        value={project.workingDir}
                        onChange={(e) => updateProject(project.id, { workingDir: e.target.value })}
                        className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 font-mono text-xs text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-cyan)]"
                        placeholder="/Users/you/project"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                        Start Command
                      </div>
                      <textarea
                        value={project.startCommand}
                        onChange={(e) => updateProject(project.id, { startCommand: e.target.value })}
                        className="min-h-[92px] w-full resize-y rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 font-mono text-xs leading-6 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-cyan)]"
                        placeholder="前端：PORT=3010 npm start&#10;后端：conda run -n pf-backend-py37 python app.py --debug=1 --mode=3"
                      />
                      <div className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">
                        后端建议用 `conda run` 或绝对 Python 路径启动，少用 `source activate`，避免服务挂掉后 shell 还停在 py 环境里。
                      </div>
                    </label>

                    {state.lastError && (
                      <div className="rounded-xl border border-[var(--accent-red)]/25 bg-[var(--accent-red)]/10 px-3 py-2 text-xs text-[var(--accent-red)]">
                        {state.lastError}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 px-4 pb-4">
                    {state.expanded ? (
                      <div className="h-[300px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]">
                        <LiveTerminal
                          key={`${project.id}-${state.runKey}`}
                          workingDir={project.workingDir}
                          startupCommand={project.startCommand}
                          sessionLabel={project.name || getProjectName(project.workingDir) || "Command"}
                          isActive
                          onSessionStarted={() => {
                            setProjectRuntime(project.id, (current) => ({
                              ...current,
                              status: "running",
                              expanded: true,
                            }));
                          }}
                          onSessionExit={() => {
                            setProjectRuntime(project.id, (current) => ({
                              ...current,
                              status: current.status === "error" ? "error" : "stopped",
                              expanded: true,
                            }));
                          }}
                          onError={(error) => {
                            setProjectRuntime(project.id, (current) => ({
                              ...current,
                              status: "error",
                              expanded: true,
                              lastError: error,
                            }));
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex h-[300px] items-center justify-center rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/70 px-6 text-center">
                        <div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">
                            {canStart ? "准备就绪" : "先补全目录和启动命令"}
                          </div>
                          <div className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">
                            启动后会在这里显示实时终端输出，你可以把前端、后端、代理服务放在同一页里一起盯。
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
