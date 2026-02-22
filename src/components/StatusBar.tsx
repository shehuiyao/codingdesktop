export default function StatusBar() {
  return (
    <div className="flex items-center justify-between px-3 py-1 text-xs border-t border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
      <span>claude: checking...</span>
      <span>Claude Code Desktop v0.1.0</span>
    </div>
  );
}
