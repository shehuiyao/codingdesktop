export interface Tab {
  id: string;
  label: string;
  workingDir: string;
  mode: "chat" | "terminal";
  yolo?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: TabBarProps) {
  return (
    <div className="flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer shrink-0 transition-colors duration-150 ${
              isActive
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
            onClick={() => onSelectTab(tab.id)}
          >
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-blue)]" />
            )}
            <span className="truncate max-w-[120px]">{tab.label}</span>
            <button
              className={`ml-1 w-4 h-4 flex items-center justify-center rounded-sm text-[10px] leading-none cursor-pointer transition-all duration-150 ${
                isActive
                  ? "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  : "opacity-0 group-hover:opacity-100 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              &#x2715;
            </button>
          </div>
        );
      })}
      <button
        onClick={onNewTab}
        className="px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer shrink-0 transition-colors duration-150"
        title="New tab"
      >
        +
      </button>
    </div>
  );
}
