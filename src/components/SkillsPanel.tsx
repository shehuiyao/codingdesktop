import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SkillInfo {
  name: string;
  source: string;
  description: string;
  category: string;
}

interface SkillsPanelProps {
  onClose: () => void;
  workingDir?: string | null;
}

const CATEGORIES = [
  { key: "official", label: "官方", color: "var(--accent-blue, #60a5fa)" },
  { key: "senguo", label: "森果", color: "var(--accent-orange, #f59e0b)" },
  { key: "personal", label: "自定义", color: "var(--accent-green)" },
] as const;

/** 小型 toggle 开关 */
function MiniToggle({
  on,
  color,
  disabled,
  label,
  title,
  onClick,
}: {
  on: boolean;
  color: string;
  disabled?: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 flex items-center gap-0.5 ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
      title={title}
    >
      <span className="text-[9px] text-[var(--text-muted)] select-none">{label}</span>
      <div
        className="relative w-6 h-3.5 rounded-full transition-colors duration-200"
        style={{
          backgroundColor: on && !disabled ? color : "var(--bg-hover, #3f3f46)",
        }}
      >
        <div
          className="absolute top-[2px] w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform duration-200"
          style={{
            transform: on && !disabled ? "translateX(11px)" : "translateX(2px)",
          }}
        />
      </div>
    </button>
  );
}

export default function SkillsPanel({ onClose, workingDir }: SkillsPanelProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [disabledSkills, setDisabledSkills] = useState<Set<string>>(new Set());
  const [globalDisabledSkills, setGlobalDisabledSkills] = useState<Set<string>>(new Set());
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [scope, setScope] = useState<"global" | "project">(workingDir ? "project" : "global");

  // 加载项目级禁用列表
  const loadDisabled = useCallback(() => {
    if (!workingDir) return;
    invoke<string[]>("get_disabled_skills", { projectPath: workingDir })
      .then((list) => setDisabledSkills(new Set(list)))
      .catch(() => {});
  }, [workingDir]);

  // 加载全局禁用列表
  const loadGlobalDisabled = useCallback(() => {
    invoke<string[]>("get_global_disabled_skills")
      .then((list) => setGlobalDisabledSkills(new Set(list)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    invoke<SkillInfo[]>("list_skills")
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
    invoke<Record<string, number>>("get_skill_usage")
      .then(setUsageCounts)
      .catch(() => {});
    loadGlobalDisabled();
  }, [loadGlobalDisabled]);

  useEffect(() => {
    loadDisabled();
  }, [loadDisabled]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // 项目级开关
  const toggleSkill = async (skillName: string, currentlyEnabled: boolean) => {
    if (!workingDir) return;
    try {
      await invoke("toggle_skill_for_project", {
        projectPath: workingDir,
        skillName,
        enabled: !currentlyEnabled,
      });
      loadDisabled();
    } catch {
      // 静默失败
    }
  };

  // 全局开关
  const toggleGlobalSkill = async (skillName: string, currentlyEnabled: boolean) => {
    try {
      await invoke("toggle_global_skill", {
        skillName,
        enabled: !currentlyEnabled,
      });
      loadGlobalDisabled();
    } catch {
      // 静默失败
    }
  };

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    skills: skills.filter((s) => s.category === cat.key),
  }));

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          已安装技能
          {skills.length > 0 && (
            <span className="ml-2 text-[var(--text-muted)] text-xs">({skills.length})</span>
          )}
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors duration-150 text-xs"
        >
          ✕
        </button>
      </div>

      {/* Scope 切换 */}
      <div className="flex items-center px-4 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex rounded-md overflow-hidden border border-[var(--border-subtle)]">
          <button
            className={`px-3 py-0.5 text-[10px] transition-colors duration-150 cursor-pointer ${
              scope === "global"
                ? "bg-[var(--accent-blue,#60a5fa)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
            onClick={() => setScope("global")}
          >
            全局
          </button>
          {workingDir && (
            <button
              className={`px-3 py-0.5 text-[10px] transition-colors duration-150 cursor-pointer border-l border-[var(--border-subtle)] ${
                scope === "project"
                  ? "bg-[var(--accent-blue,#60a5fa)] text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              }`}
              onClick={() => setScope("project")}
            >
              项目
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="text-xs text-[var(--text-secondary)] text-center py-8">加载中...</div>
        )}

        {!loading && skills.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] text-center py-8">
            暂无已安装技能
          </div>
        )}

        {!loading &&
          grouped.map(
            (group) =>
              group.skills.length > 0 && (
                <div key={group.key} className="mb-5">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1 flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: group.color }}
                    />
                    {group.label}
                    <span className="text-[var(--text-muted)]">({group.skills.length})</span>
                  </div>
                  <div className="grid gap-1.5">
                    {group.skills.map((skill) => {
                      const isOpen = expanded.has(skill.name);
                      const globalEnabled = !globalDisabledSkills.has(skill.name);
                      const projectEnabled = !disabledSkills.has(skill.name);
                      const isEnabled = scope === "global" ? globalEnabled : globalEnabled && projectEnabled;
                      const count = usageCounts[skill.name] || 0;
                      return (
                        <div
                          key={skill.name}
                          className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] overflow-hidden"
                        >
                          <div className="flex items-center gap-2 px-3 py-2">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: group.color,
                                opacity: isEnabled ? 1 : 0.3,
                              }}
                            />
                            <span
                              className={`text-xs flex-1 truncate cursor-pointer hover:underline ${
                                isEnabled
                                  ? "text-[var(--text-primary)]"
                                  : "text-[var(--text-muted)] line-through"
                              }`}
                              onClick={() => skill.description && toggleExpand(skill.name)}
                            >
                              {skill.name}
                            </span>
                            {count > 0 && (
                              <span className="text-[10px] text-[var(--text-muted)] shrink-0" title="使用次数">
                                {count}次
                              </span>
                            )}
                            {scope === "global" ? (
                              <MiniToggle
                                on={globalEnabled}
                                color={group.color}
                                label=""
                                title={globalEnabled ? "全局禁用此技能" : "全局启用此技能"}
                                onClick={() => toggleGlobalSkill(skill.name, globalEnabled)}
                              />
                            ) : (
                              <MiniToggle
                                on={projectEnabled}
                                color={group.color}
                                disabled={!globalEnabled}
                                label=""
                                title={
                                  !globalEnabled
                                    ? "全局已禁用，请先全局启用"
                                    : projectEnabled
                                      ? "在此项目中禁用"
                                      : "在此项目中启用"
                                }
                                onClick={() => toggleSkill(skill.name, projectEnabled)}
                              />
                            )}
                            {/* 展开箭头 */}
                            {skill.description && (
                              <span
                                className="text-[10px] text-[var(--text-muted)] shrink-0 cursor-pointer transition-transform duration-150"
                                style={{
                                  display: "inline-block",
                                  transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                                }}
                                onClick={() => toggleExpand(skill.name)}
                              >
                                ▸
                              </span>
                            )}
                          </div>
                          {isOpen && skill.description && (
                            <div className="px-3 pb-2.5 pt-0">
                              <div className="text-[11px] leading-relaxed text-[var(--text-secondary)] pl-5 border-l-2 border-[var(--border-subtle)] ml-[3px]">
                                {skill.description}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
          )}
      </div>
    </div>
  );
}
