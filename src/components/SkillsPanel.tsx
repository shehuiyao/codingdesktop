import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SkillInfo {
  id: string;
  name: string;
  source: string;
  description: string;
  category: string;
  path: string;
  enabled: boolean;
  can_toggle: boolean;
  usage_count: number;
  first_used_at?: string | null;
  last_used_at?: string | null;
}

interface SkillsPanelProps {
  onClose: () => void;
  workingDir?: string | null;
}

type SortMode = "usage" | "name" | "recent";
type FilterMode = "all" | "enabled" | "disabled" | "unused";

const CATEGORIES = [
  { key: "official", label: "官方", color: "var(--accent-blue, #58a6ff)" },
  { key: "senguo", label: "森果", color: "var(--accent-orange, #f59e0b)" },
  { key: "personal", label: "自定义", color: "var(--accent-green)" },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  codex: "Codex",
  agents: "Agents",
  claude: "Claude",
  system: "系统",
  plugin: "插件",
};

function formatCount(value: number) {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDate(value?: string | null) {
  if (!value) return "从未使用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? source;
}

function categoryMeta(category: string) {
  return CATEGORIES.find((item) => item.key === category) ?? CATEGORIES[2];
}

function MiniToggle({
  on,
  disabled,
  title,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-all ${
        disabled
          ? "cursor-not-allowed border-[var(--border-subtle)] bg-[var(--bg-tertiary)] opacity-40"
          : on
            ? "cursor-pointer border-[var(--accent-cyan)] bg-[var(--accent-cyan)]"
            : "cursor-pointer border-[var(--border-color)] bg-[var(--bg-hover)]"
      }`}
      title={title}
    >
      <span
        className="absolute top-[3px] h-3 w-3 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: on ? "translateX(19px)" : "translateX(3px)" }}
      />
    </button>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-3">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-1 truncate text-[10px] text-[var(--text-muted)]">{sub}</div>
    </div>
  );
}

function UsageBars({ skills }: { skills: SkillInfo[] }) {
  const rows = skills.filter((skill) => skill.usage_count > 0).slice(0, 8);
  const max = Math.max(...rows.map((skill) => skill.usage_count), 1);

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">使用排行</h2>
        <span className="text-[11px] text-[var(--text-muted)]">Top 8</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">还没有使用记录</div>
      ) : (
        <div className="space-y-3">
          {rows.map((skill) => {
            const meta = categoryMeta(skill.category);
            return (
              <div key={skill.id} className="grid grid-cols-[minmax(90px,1fr)_minmax(110px,1.4fr)_auto] items-center gap-3 text-xs">
                <div className="truncate text-[var(--text-secondary)]" title={skill.name}>{skill.name}</div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(4, (skill.usage_count / max) * 100)}%`, backgroundColor: meta.color }}
                  />
                </div>
                <div className="tabular-nums text-[var(--text-primary)]">{formatCount(skill.usage_count)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StateDonut({ enabled, disabled }: { enabled: number; disabled: number }) {
  const total = Math.max(enabled + disabled, 1);
  const enabledPercent = Math.round((enabled / total) * 100);

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">启用状态</h2>
        <span className="text-[11px] text-[var(--text-muted)]">{enabledPercent}% 开启</span>
      </div>
      <div className="flex items-center gap-4">
        <div
          className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--accent-cyan) 0 ${enabledPercent}%, var(--accent-red) ${enabledPercent}% 100%)`,
          }}
        >
          <div className="grid h-[68px] w-[68px] place-items-center rounded-full bg-[var(--bg-secondary)] text-sm font-semibold text-[var(--text-primary)]">
            {enabledPercent}%
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full bg-[var(--accent-cyan)]" />已开启</span>
            <span className="tabular-nums text-[var(--text-primary)]">{enabled}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full bg-[var(--accent-red)]" />已隐藏</span>
            <span className="tabular-nums text-[var(--text-primary)]">{disabled}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryBars({ skills }: { skills: SkillInfo[] }) {
  const rows = CATEGORIES.map((category) => ({
    ...category,
    count: skills.filter((skill) => skill.category === category.key).length,
  }));
  const max = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">技能分布</h2>
        <span className="text-[11px] text-[var(--text-muted)]">按来源语义</span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 text-xs">
            <span className="text-[var(--text-secondary)]">{row.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
              <div className="h-full rounded-full" style={{ width: `${(row.count / max) * 100}%`, backgroundColor: row.color }} />
            </div>
            <span className="tabular-nums text-[var(--text-primary)]">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function uniqueByName(skills: SkillInfo[]) {
  const map = new Map<string, SkillInfo>();
  skills.forEach((skill) => {
    const current = map.get(skill.name);
    if (!current) {
      map.set(skill.name, skill);
      return;
    }
    const currentTime = new Date(current.last_used_at || 0).getTime();
    const nextTime = new Date(skill.last_used_at || 0).getTime();
    if (skill.usage_count > current.usage_count || nextTime > currentTime) {
      map.set(skill.name, skill);
    }
  });
  return Array.from(map.values());
}

export default function SkillsPanel({ onClose, workingDir }: SkillsPanelProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [projectDisabledSkills, setProjectDisabledSkills] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("usage");

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await invoke<SkillInfo[]>("list_skills");
      setSkills(next);
    } catch (err) {
      setError(String(err));
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjectDisabled = useCallback(() => {
    if (!workingDir) return;
    invoke<string[]>("get_disabled_skills", { projectPath: workingDir })
      .then((list) => setProjectDisabledSkills(new Set(list)))
      .catch(() => {});
  }, [workingDir]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    loadProjectDisabled();
  }, [loadProjectDisabled]);

  const chartSkills = useMemo(() => uniqueByName(skills), [skills]);

  const stats = useMemo(() => {
    const enabled = skills.filter((skill) => skill.enabled).length;
    const used = chartSkills.filter((skill) => skill.usage_count > 0).length;
    const totalUsage = chartSkills.reduce((sum, skill) => sum + skill.usage_count, 0);
    const recent = chartSkills
      .filter((skill) => skill.last_used_at)
      .sort((a, b) => new Date(b.last_used_at || 0).getTime() - new Date(a.last_used_at || 0).getTime())[0];
    return {
      total: skills.length,
      enabled,
      disabled: skills.length - enabled,
      used,
      unused: chartSkills.length - used,
      totalUsage,
      recent,
    };
  }, [chartSkills, skills]);

  const filteredSkills = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const next = skills.filter((skill) => {
      if (filter === "enabled" && !skill.enabled) return false;
      if (filter === "disabled" && skill.enabled) return false;
      if (filter === "unused" && skill.usage_count > 0) return false;
      if (!keyword) return true;
      return [skill.name, skill.description, skill.source, skill.category].some((value) => value.toLowerCase().includes(keyword));
    });

    return next.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "recent") return new Date(b.last_used_at || 0).getTime() - new Date(a.last_used_at || 0).getTime();
      return b.usage_count - a.usage_count || a.name.localeCompare(b.name);
    });
  }, [filter, query, skills, sort]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGlobalSkill = async (skill: SkillInfo) => {
    if (!skill.can_toggle) return;
    try {
      await invoke("toggle_installed_skill", {
        skillPath: skill.path,
        enabled: !skill.enabled,
      });
      await loadSkills();
    } catch (err) {
      setError(String(err));
    }
  };

  const toggleProjectSkill = async (skill: SkillInfo) => {
    if (!workingDir) return;
    const projectEnabled = !projectDisabledSkills.has(skill.name);
    try {
      await invoke("toggle_skill_for_project", {
        projectPath: workingDir,
        skillName: skill.name,
        enabled: !projectEnabled,
      });
      loadProjectDisabled();
    } catch (err) {
      setError(String(err));
    }
  };

  const syncEnabledFields = async () => {
    setSyncing(true);
    setError("");
    try {
      await invoke<number>("sync_skill_enabled_fields");
      await loadSkills();
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  };

  const openPath = (path: string) => {
    invoke("reveal_in_finder", { path }).catch(() => {});
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[radial-gradient(circle_at_top_left,rgba(188,140,255,0.09),transparent_30%),var(--bg-primary)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/95 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-[var(--text-primary)]">Skills 使用看板</h1>
            <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
              本地账本：~/.codex/skill-usage.json
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={syncEnabledFields}
              disabled={syncing}
              className="h-7 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
              title="把当前目录状态同步写入 enabled: true/false"
            >
              {syncing ? "同步中" : "同步"}
            </button>
            <button
              onClick={loadSkills}
              disabled={loading}
              className="grid h-7 w-7 place-items-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
              title="刷新"
            >
              ↻
            </button>
            <button
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-3 rounded-xl border border-[var(--accent-red)]/35 bg-[var(--accent-red)]/10 px-3 py-2 text-xs text-[var(--accent-red)]">
            {error}
          </div>
        )}

        <div className="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="技能总数" value={formatCount(stats.total)} sub={`${chartSkills.length} 个唯一名称`} />
          <StatCard label="使用次数" value={formatCount(stats.totalUsage)} sub={`${stats.used} 个技能有记录`} />
          <StatCard label="闲置技能" value={formatCount(stats.unused)} sub="可考虑先隐藏观察" />
          <StatCard label="最近使用" value={stats.recent?.name ?? "-"} sub={formatDate(stats.recent?.last_used_at)} />
        </div>

        <div className="mb-3 grid grid-cols-1 gap-3 2xl:grid-cols-[1.25fr_0.8fr_0.8fr]">
          <UsageBars skills={chartSkills} />
          <StateDonut enabled={stats.enabled} disabled={stats.disabled} />
          <CategoryBars skills={chartSkills} />
        </div>

        <div className="sticky top-0 z-20 mb-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/88 p-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索技能、描述、来源"
              className="h-8 min-w-[180px] flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <div className="inline-flex overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
              {([
                ["all", "全部"],
                ["enabled", "开启"],
                ["disabled", "隐藏"],
                ["unused", "闲置"],
              ] as [FilterMode, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`h-8 px-3 text-xs transition-colors ${
                    filter === value ? "bg-[var(--accent-purple)] text-[#0d1117]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className="h-8 appearance-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] pl-3 pr-8 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="usage" className="bg-[var(--bg-primary)]">按使用次数</option>
                <option value="recent" className="bg-[var(--bg-primary)]">按最近使用</option>
                <option value="name" className="bg-[var(--bg-primary)]">按名称</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">▼</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 py-10 text-center text-sm text-[var(--text-muted)]">
            正在扫描技能目录...
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 py-10 text-center text-sm text-[var(--text-muted)]">
            没有符合条件的技能
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSkills.map((skill) => {
              const meta = categoryMeta(skill.category);
              const isOpen = expanded.has(skill.id);
              const projectEnabled = !projectDisabledSkills.has(skill.name);
              return (
                <div
                  key={skill.id}
                  className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92"
                >
                  <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                    <button
                      onClick={() => toggleExpand(skill.id)}
                      className="min-w-0 cursor-pointer text-left"
                      title={skill.description || skill.name}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color, opacity: skill.enabled ? 1 : 0.35 }} />
                        <span className={`truncate text-sm font-medium ${skill.enabled ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] line-through"}`}>
                          {skill.name}
                        </span>
                        <span className="shrink-0 rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                          {sourceLabel(skill.source)}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                        <span>{formatCount(skill.usage_count)} 次使用</span>
                        <span>最近：{formatDate(skill.last_used_at)}</span>
                        {!skill.can_toggle && <span>只读</span>}
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-3">
                      {workingDir && (
                        <div className="flex items-center gap-1.5" title={!skill.enabled ? "全局隐藏后，项目开关不会生效" : "项目级开关写入 .claude/settings.local.json"}>
                          <span className="text-[10px] text-[var(--text-muted)]">项目</span>
                          <MiniToggle
                            on={projectEnabled && skill.enabled}
                            disabled={!skill.enabled}
                            title={projectEnabled ? "在当前项目禁用" : "在当前项目启用"}
                            onClick={() => toggleProjectSkill(skill)}
                          />
                        </div>
                      )}
                      <div className="flex items-center gap-1.5" title={skill.can_toggle ? "移动 skill 目录并写入 enabled 字段" : "插件技能暂不支持移动隐藏"}>
                        <span className="text-[10px] text-[var(--text-muted)]">全局</span>
                        <MiniToggle
                          on={skill.enabled}
                          disabled={!skill.can_toggle}
                          title={skill.enabled ? "隐藏此 skill" : "启用此 skill"}
                          onClick={() => toggleGlobalSkill(skill)}
                        />
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-[var(--border-subtle)] px-4 py-3">
                      {skill.description && (
                        <div className="mb-3 border-l-2 border-[var(--border-color)] pl-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                          {skill.description}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <span className="max-w-full truncate rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1" title={skill.path}>
                          {skill.path}
                        </span>
                        <button
                          onClick={() => openPath(skill.path)}
                          className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          访达
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
