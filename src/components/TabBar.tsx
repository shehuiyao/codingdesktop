export interface Tab {
  id: string;
  label: string;
  workingDir: string;
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
    <div className="flex items-center border-b border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--border-color)] shrink-0 ${
              isActive
                ? "bg-[var(--accent-blue)] text-white"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
            }`}
            onClick={() => onSelectTab(tab.id)}
          >
            <span className="truncate max-w-[120px]">{tab.label}</span>
            <button
              className={`ml-1 hover:opacity-100 text-[10px] leading-none cursor-pointer ${
                isActive ? "opacity-70 text-white" : "opacity-50 text-[var(--text-secondary)]"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              x
            </button>
          </div>
        );
      })}
      <button
        onClick={onNewTab}
        className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] cursor-pointer shrink-0"
      >
        +
      </button>
    </div>
  );
}
