import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import LiveTerminal from "./LiveTerminal";

interface LaunchpadProject {
  id: string;
  name: string;
  workingDir: string;
  startCommand: string;
}

type ProjectRuntimeStatus = "idle" | "starting" | "running" | "stopped" | "error";

interface ProjectRuntimeState {
  status: ProjectRuntimeStatus;
  runKey: number;
  expanded: boolean;
  lastError: string;
}

const STORAGE_KEY = "claude-desktop-launchpad-projects";

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `launch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createProject(seed?: Partial<LaunchpadProject>): LaunchpadProject {
  return {
    id: createId(),
    name: "",
    workingDir: "",
    startCommand: "npm run dev",
    ...seed,
  };
}

function getProjectName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function loadProjects(): LaunchpadProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Partial<LaunchpadProject> => !!item && typeof item === "object")
      .map((item) => createProject(item));
  } catch {
    return [];
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
  const [projects, setProjects] = useState<LaunchpadProject[]>(loadProjects);
  const [runtime, setRuntime] = useState<Record<string, ProjectRuntimeState>>({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  const runningCount = Object.values(runtime).filter(
    (item) => item.status === "starting" || item.status === "running",
  ).length;

  const updateProject = (id: string, patch: Partial<LaunchpadProject>) => {
    setProjects((prev) =>
      prev.map((project) => (project.id === id ? { ...project, ...patch } : project)),
    );
  };

  const addProject = () => {
    setProjects((prev) => [...prev, createProject()]);
  };

  const removeProject = (id: string) => {
    setProjects((prev) => prev.filter((project) => project.id !== id));
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

  const handleStop = (projectId: string) => {
    setProjectRuntime(projectId, (current) => ({
      ...current,
      status: "stopped",
      expanded: false,
    }));
  };

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(57,210,192,0.09),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(88,166,255,0.08),transparent_24%)]">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-5 shadow-[0_18px_60px_var(--shadow-color)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--accent-cyan)]">
                Project Launchpad
              </div>
              <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
                前后端启动工作台
              </div>
              <div className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                每个卡片对应一个项目窗口。目录和启动命令会自动记住，之后只需要点一下就能启动或关闭，并且能直接看到终端输出。
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                {projects.length} 个项目 · {runningCount} 个运行中
              </div>
              <button
                onClick={addProject}
                className="rounded-xl bg-[var(--accent-cyan)] px-4 py-2 text-sm font-medium text-[#0d1117] transition hover:brightness-110 active:brightness-95"
              >
                新增项目
              </button>
            </div>
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
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-5">
            {projects.map((project) => {
              const state = runtime[project.id] ?? emptyRuntime();
              const isRunning = state.status === "starting" || state.status === "running";
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
                        disabled={!isRunning && !canStart}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                          isRunning
                            ? "bg-[var(--accent-red)] text-white hover:brightness-110"
                            : "bg-[var(--accent-green)] text-[#08140d] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                        }`}
                      >
                        {isRunning ? "关闭" : "启动"}
                      </button>
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
                        placeholder="npm run dev"
                      />
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
