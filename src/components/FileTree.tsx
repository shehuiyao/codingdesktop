import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface TreeNodeProps {
  entry: FileEntry;
}

function TreeNode({ entry }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const toggle = useCallback(async () => {
    if (!entry.is_dir) return;
    if (!loaded) {
      try {
        const entries = await invoke<FileEntry[]>("list_directory", {
          path: entry.path,
        });
        setChildren(entries);
        setLoaded(true);
      } catch {
        setChildren([]);
        setLoaded(true);
      }
    }
    setExpanded((prev) => !prev);
  }, [entry.path, entry.is_dir, loaded]);

  return (
    <div>
      <div
        onClick={toggle}
        className={`flex items-center gap-1.5 px-2 py-0.5 text-xs truncate rounded-sm transition-colors duration-100 ${
          entry.is_dir
            ? "text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        {entry.is_dir ? (
          <span className="w-3 text-center text-[10px] text-[var(--text-secondary)]">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
        ) : (
          <span className="w-3" />
        )}
        <span>{entry.is_dir ? "\uD83D\uDCC1" : "\uD83D\uDCC4"}</span>
        <span className="truncate">{entry.name}</span>
      </div>
      {expanded && children.length > 0 && (
        <div className="pl-3">
          {children.map((child) => (
            <TreeNode key={child.path} entry={child} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileTreeProps {
  rootPath: string;
}

export default function FileTree({ rootPath }: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rootPath) return;
    setError(null);
    invoke<FileEntry[]>("list_directory", { path: rootPath })
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, [rootPath]);

  return (
    <div className="w-56 border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex flex-col overflow-hidden">
      <div className="px-3 py-2 text-[10px] font-medium text-[var(--text-muted)] border-b border-[var(--border-subtle)] uppercase tracking-wider">
        Explorer
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {error ? (
          <div className="px-3 py-2 text-xs text-[var(--accent-red)]">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">
            No files
          </div>
        ) : (
          entries.map((entry) => (
            <TreeNode key={entry.path} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
