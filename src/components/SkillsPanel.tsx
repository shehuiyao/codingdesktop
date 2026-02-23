import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SkillInfo {
  name: string;
  source: string;
}

interface SkillsPanelProps {
  onClose: () => void;
}

export default function SkillsPanel({ onClose }: SkillsPanelProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<SkillInfo[]>("list_skills")
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  const plugins = skills.filter((s) => s.source === "plugin");
  const custom = skills.filter((s) => s.source === "custom");

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          Installed Skills
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
          <div className="text-xs text-[var(--text-secondary)] text-center py-8">Loading skills...</div>
        )}

        {!loading && skills.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] text-center py-8">
            No skills installed
          </div>
        )}

        {!loading && plugins.length > 0 && (
          <div className="mb-6">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">
              Plugins
            </div>
            <div className="grid gap-2">
              {plugins.map((skill) => (
                <div
                  key={skill.name}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]"
                >
                  <span className="w-2 h-2 rounded-full bg-[var(--accent-purple)] shrink-0" />
                  <span className="text-xs text-[var(--text-primary)] truncate">{skill.name}</span>
                  <span className="ml-auto text-[10px] text-[var(--accent-purple)]">plugin</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && custom.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">
              Custom
            </div>
            <div className="grid gap-2">
              {custom.map((skill) => (
                <div
                  key={skill.name}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]"
                >
                  <span className="w-2 h-2 rounded-full bg-[var(--accent-green)] shrink-0" />
                  <span className="text-xs text-[var(--text-primary)] truncate">{skill.name}</span>
                  <span className="ml-auto text-[10px] text-[var(--accent-green)]">custom</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
