import { useState, useRef, useCallback, useEffect } from "react";

export type CliTool = "claude" | "gemini";

export interface Tab {
  id: string;
  label: string;
  workingDir: string;
  mode: "chat" | "terminal";
  yolo?: boolean;
  tool?: CliTool;
  status?: "idle" | "running" | "waiting" | "error" | "done";
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  splitTabId?: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onReorderTabs?: (tabs: Tab[]) => void;
  onDragStateChange?: (dragging: boolean, tabId: string | null) => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  splitTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onReorderTabs,
  onDragStateChange,
}: TabBarProps) {
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<"left" | "right">("left");
  // 浮动拖拽幽灵的位置
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // 拖拽起始时鼠标相对 tab 左上角的偏移
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  // 延迟判定是否为拖拽（区分点击和拖拽）
  const pointerStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const isDraggingRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent, tabId: string) => {
    // 只响应左键，忽略关闭按钮上的点击
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, id: tabId };
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      // 还没按下
      if (!pointerStartRef.current) return;

      const start = pointerStartRef.current;

      // 判定拖拽阈值（移动超过 4px 才开始拖拽）
      if (!isDraggingRef.current) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        isDraggingRef.current = true;
        setDragTabId(start.id);
        onDragStateChange?.(true, start.id);

        // 计算偏移
        const tabEl = tabRefs.current.get(start.id);
        if (tabEl) {
          const rect = tabEl.getBoundingClientRect();
          dragOffsetRef.current = { x: start.x - rect.left, y: start.y - rect.top };
        }
      }

      // 更新幽灵位置
      setGhostPos({ x: e.clientX - dragOffsetRef.current.x, y: e.clientY - dragOffsetRef.current.y });

      // 计算放置目标
      if (containerRef.current) {
        for (const [id, el] of tabRefs.current.entries()) {
          if (id === start.id) continue;
          const rect = el.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
            const midX = rect.left + rect.width / 2;
            setDropTargetId(id);
            setDropSide(e.clientX < midX ? "left" : "right");
            return;
          }
        }
        setDropTargetId(null);
      }
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current && pointerStartRef.current) {
        const dragId = pointerStartRef.current.id;
        // 执行重排
        if (dragId && dropTargetId && dragId !== dropTargetId && onReorderTabs) {
          const reordered = [...tabs];
          const dragIndex = reordered.findIndex((t) => t.id === dragId);
          if (dragIndex !== -1) {
            const [dragged] = reordered.splice(dragIndex, 1);
            let insertIndex = reordered.findIndex((t) => t.id === dropTargetId);
            if (dropSide === "right") insertIndex += 1;
            reordered.splice(insertIndex, 0, dragged);
            onReorderTabs(reordered);
          }
        }
      }
      // 通知父组件拖拽结束
      onDragStateChange?.(false, null);
      // 重置状态
      pointerStartRef.current = null;
      isDraggingRef.current = false;
      setDragTabId(null);
      setDropTargetId(null);
      setGhostPos(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [tabs, dropTargetId, dropSide, onReorderTabs, onDragStateChange]);

  // 拖拽中的 tab 信息
  const dragTab = dragTabId ? tabs.find((t) => t.id === dragTabId) : null;

  return (
    <div ref={containerRef} className="flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isDragging = tab.id === dragTabId;
        const isDropTarget = tab.id === dropTargetId && dragTabId !== null && dragTabId !== tab.id;
        return (
          <div
            key={tab.id}
            ref={(el) => { if (el) tabRefs.current.set(tab.id, el); else tabRefs.current.delete(tab.id); }}
            onPointerDown={(e) => handlePointerDown(e, tab.id)}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer shrink-0 select-none transition-colors duration-150 ${
              isActive
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
            style={{
              opacity: isDragging ? 0.3 : 1,
              borderLeft: isDropTarget && dropSide === "left" ? "2px solid var(--accent-cyan)" : undefined,
              borderRight: isDropTarget && dropSide === "right" ? "2px solid var(--accent-cyan)" : undefined,
            }}
            onClick={() => onSelectTab(tab.id)}
          >
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-blue)]" />
            )}
            {/* Status dot */}
            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
              tab.status === "waiting" ? "bg-[var(--accent-orange,#f59e0b)] animate-pulse" :
              tab.status === "running" ? "bg-[var(--accent-green)] animate-pulse" :
              tab.status === "error" ? "bg-[var(--accent-red)]" :
              tab.status === "done" ? "bg-[var(--accent-blue)]" :
              "bg-[var(--text-muted)]"
            }`} />
            {tab.id === splitTabId && (
              <span className="text-[8px] text-[var(--accent-cyan)] ml-0.5" title="Split right">⫿</span>
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

      {/* 拖拽幽灵 - 跟随鼠标移动 */}
      {dragTab && ghostPos && (
        <div
          className="fixed z-[9999] flex items-center gap-1.5 px-3 py-2 text-xs rounded-md bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--accent-cyan)] shadow-lg shadow-black/30 pointer-events-none"
          style={{ left: ghostPos.x, top: ghostPos.y }}
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            dragTab.status === "waiting" ? "bg-[var(--accent-orange,#f59e0b)]" :
            dragTab.status === "running" ? "bg-[var(--accent-green)]" :
            dragTab.status === "error" ? "bg-[var(--accent-red)]" :
            dragTab.status === "done" ? "bg-[var(--accent-blue)]" :
            "bg-[var(--text-muted)]"
          }`} />
          <span>{dragTab.label}</span>
        </div>
      )}
    </div>
  );
}
