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

export default function SkillsPanel({ onClose, workingDir }: SkillsPanelProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [disabledSkills, setDisabledSkills] = useState<Set<string>>(new Set());

  const loadDisabled = useCallback(() => {
    if (!workingDir) return;
    invoke<string[]>("get_disabled_skills", { projectPath: workingDir })
      .then((list) => setDisabledSkills(new Set(list)))
      .catch(() => {});
  }, [workingDir]);

  useEffect(() => {
    invoke<SkillInfo[]>("list_skills")
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

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
                      const isEnabled = !disabledSkills.has(skill.name);
                      return (
                        <div
                          key={skill.name}
                          className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] overflow-hidden"
                        >
                          <div className="flex items-center gap-3 px-3 py-2">
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
                            {/* 开关 */}
                            {workingDir && (
                              <button
                                onClick={() => toggleSkill(skill.name, isEnabled)}
                                className="shrink-0 cursor-pointer"
                                title={isEnabled ? "在此项目中禁用" : "在此项目中启用"}
                              >
                                <div
                                  className="relative w-7 h-4 rounded-full transition-colors duration-200"
                                  style={{
                                    backgroundColor: isEnabled
                                      ? group.color
                                      : "var(--bg-hover, #3f3f46)",
                                  }}
                                >
                                  <div
                                    className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200"
                                    style={{
                                      transform: isEnabled ? "translateX(14px)" : "translateX(2px)",
                                    }}
                                  />
                                </div>
                              </button>
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
