import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface GitInfo {
  branch: string;
  additions: number;
  deletions: number;
}

interface BranchList {
  current: string;
  local: string[];
  remote: string[];
}

interface SwitchResult {
  success: boolean;
  message: string;
}

interface BranchSwitcherProps {
  gitInfo: GitInfo | null;
  workingDir: string | null;
  onBranchSwitched: () => void;
}

export default function BranchSwitcher({
  gitInfo,
  workingDir,
  onBranchSwitched,
}: BranchSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRemote, setShowRemote] = useState(false);
  const [confirmBranch, setConfirmBranch] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setConfirmBranch(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const fetchBranches = useCallback(async () => {
    if (!workingDir) return;
    setLoading(true);
    try {
      const result = await invoke<BranchList>("list_branches", {
        path: workingDir,
      });
      setBranches(result);
    } catch {
      setBranches(null);
    } finally {
      setLoading(false);
    }
  }, [workingDir]);

  const handleToggle = useCallback(() => {
    if (!open) {
      fetchBranches();
    } else {
      setConfirmBranch(null);
    }
    setOpen((prev) => !prev);
  }, [open, fetchBranches]);

  const handleSwitch = useCallback(
    async (branch: string, force = false) => {
      if (!workingDir) return;
      setSwitching(true);
      try {
        const result = await invoke<SwitchResult>("switch_branch", {
          path: workingDir,
          branch,
          force,
        });
        if (result.success) {
          setOpen(false);
          setConfirmBranch(null);
          onBranchSwitched();
        } else if (result.message === "dirty") {
          setConfirmBranch(branch);
        }
      } catch {
        // switch failed silently
      } finally {
        setSwitching(false);
      }
    },
    [workingDir, onBranchSwitched],
  );

  if (!gitInfo) return null;

  const displayBranches = branches
    ? showRemote
      ? [...branches.local, ...branches.remote]
      : branches.local
    : [];

  return (
    <div className="relative flex items-center gap-2" ref={dropdownRef}>
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors duration-150 rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="text-[var(--accent-orange)]"
        >
          <path d="M5.45 3.18a.7.7 0 0 0-.99 0L.73 6.91a.7.7 0 0 0 0 .99l3.73 3.73a.7.7 0 0 0 .99-.99L2.22 7.4l3.23-3.23a.7.7 0 0 0 0-.99zm5.1 0a.7.7 0 0 1 .99 0l3.73 3.73a.7.7 0 0 1 0 .99l-3.73 3.73a.7.7 0 0 1-.99-.99L13.78 7.4l-3.23-3.23a.7.7 0 0 1 0-.99z" />
        </svg>
        <span className="truncate max-w-[120px]">{gitInfo.branch}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 12 12"
          fill="currentColor"
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[var(--accent-green)]">+{gitInfo.additions}</span>
        <span className="text-[var(--accent-red)]">-{gitInfo.deletions}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
              Branches
            </span>
            <button
              onClick={() => setShowRemote((prev) => !prev)}
              className={`text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-colors duration-150 ${
                showRemote
                  ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Remote
            </button>
          </div>

          {/* Dirty workspace confirm */}
          {confirmBranch && (
            <div className="px-3 py-2 bg-[var(--accent-orange)]/10 border-b border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--accent-orange)] mb-1.5">
                Uncommitted changes detected
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSwitch(confirmBranch, true)}
                  disabled={switching}
                  className="px-2 py-1 text-[10px] rounded bg-[var(--accent-orange)] text-[#0d1117] cursor-pointer hover:brightness-110 transition-all duration-150"
                >
                  {switching ? "Switching..." : "Force Switch"}
                </button>
                <button
                  onClick={() => setConfirmBranch(null)}
                  className="px-2 py-1 text-[10px] rounded bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors duration-150"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Branch list */}
          <div className="max-h-64 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-2 text-[10px] text-[var(--text-muted)]">
                Loading...
              </div>
            ) : displayBranches.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-[var(--text-muted)]">
                No branches found
              </div>
            ) : (
              displayBranches.map((branch) => {
                const isCurrent = branch === branches?.current;
                return (
                  <button
                    key={branch}
                    onClick={() => !isCurrent && handleSwitch(branch)}
                    disabled={isCurrent || switching}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors duration-100 ${
                      isCurrent
                        ? "text-[var(--accent-green)] bg-[var(--accent-green)]/5"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
                    }`}
                  >
                    <span className="w-3 text-center text-[10px]">
                      {isCurrent ? "\u2713" : ""}
                    </span>
                    <span className="truncate font-mono text-[11px]">
                      {branch}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
