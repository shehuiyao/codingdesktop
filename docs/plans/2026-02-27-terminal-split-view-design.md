# 终端分屏 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 支持拖拽 tab 到主内容区右侧实现左右分屏，同时展示两个已有终端。

**Architecture:** 在 App.tsx 新增 `splitTabId` 和 `splitRatio` 状态控制分屏。TabBar 的拖拽事件扩展到主内容区域，检测 drop 到右半区域时触发分屏。新增 SplitDivider 组件处理分隔线拖拽调整比例。

**Tech Stack:** React + TypeScript + Tailwind CSS（现有技术栈，无新依赖）

---

### Task 1: 新增 SplitDivider 组件

**Files:**
- Create: `src/components/SplitDivider.tsx`

**Step 1: 创建 SplitDivider 组件**

```tsx
// src/components/SplitDivider.tsx
import { useCallback, useRef } from "react";

interface SplitDividerProps {
  onRatioChange: (ratio: number) => void;
}

export default function SplitDivider({ onRatioChange }: SplitDividerProps) {
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        // 计算相对于主内容区域的比例
        const parent = (e.target as HTMLElement).parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        let ratio = (ev.clientX - rect.left) / rect.width;
        // 限制范围
        ratio = Math.max(0.25, Math.min(0.75, ratio));
        onRatioChange(ratio);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onRatioChange],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 shrink-0 cursor-col-resize bg-[var(--border-subtle)] hover:bg-[var(--accent-cyan)] transition-colors duration-150"
    />
  );
}
```

**Step 2: 验证文件创建成功**

Run: `ls src/components/SplitDivider.tsx`
Expected: 文件存在

**Step 3: Commit**

```bash
git add src/components/SplitDivider.tsx
git commit -m "feat: 新增 SplitDivider 分隔线组件，支持拖拽调整分屏比例"
```

---

### Task 2: 扩展 TabBar 拖拽事件，支持向外传递拖拽信息

**Files:**
- Modify: `src/components/TabBar.tsx`

**Step 1: 给 TabBarProps 新增 onSplitDrop 回调和 splitTabId 标记**

在 `TabBarProps` 接口（第 15-22 行）中添加：

```typescript
interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  splitTabId?: string | null;          // 新增：正在右侧分屏的 tab id
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onReorderTabs?: (tabs: Tab[]) => void;
  onDragStateChange?: (dragging: boolean, tabId: string | null) => void;  // 新增：通知父组件拖拽状态
  onSplitDrop?: (tabId: string) => void;  // 新增：tab 被 drop 到分屏区域
}
```

**Step 2: 解构新 props 并暴露拖拽状态**

在组件函数参数中解构 `splitTabId`、`onDragStateChange`、`onSplitDrop`。

在拖拽开始时（`isDraggingRef.current = true` 那里，约第 65 行）调用：
```typescript
onDragStateChange?.(true, start.id);
```

在 `handlePointerUp` 中（约第 95 行），在重置前调用：
```typescript
onDragStateChange?.(false, null);
```

**Step 3: 右侧分屏的 tab 在 tab 栏中加标记**

在 tab 渲染区域（第 157 行 status dot 附近），如果 `tab.id === splitTabId`，在 tab label 后面添加一个小图标：

```tsx
{tab.id === splitTabId && (
  <span className="text-[8px] text-[var(--accent-cyan)] ml-0.5" title="Split right">⫿</span>
)}
```

**Step 4: Commit**

```bash
git add src/components/TabBar.tsx
git commit -m "feat: TabBar 扩展拖拽事件，支持向父组件传递拖拽状态和分屏标记"
```

---

### Task 3: App.tsx 添加分屏状态和 drop zone

**Files:**
- Modify: `src/App.tsx`

**Step 1: 新增分屏状态**

在 App 函数中（约第 32 行附近）添加：

```typescript
// 分屏状态
const [splitTabId, setSplitTabId] = useState<string | null>(null);
const [splitRatio, setSplitRatio] = useState(0.5);
// TabBar 拖拽状态
const [tabDragging, setTabDragging] = useState(false);
const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
```

**Step 2: 添加拖拽状态回调**

```typescript
const handleTabDragStateChange = useCallback((dragging: boolean, tabId: string | null) => {
  setTabDragging(dragging);
  setDraggingTabId(tabId);
}, []);
```

**Step 3: 添加 drop zone 处理**

```typescript
const [showDropZone, setShowDropZone] = useState(false);

const handleContentDragOver = useCallback(
  (e: React.MouseEvent) => {
    if (!tabDragging) return;
    // 判断鼠标是否在右半部分
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isRightHalf = e.clientX > rect.left + rect.width / 2;
    setShowDropZone(isRightHalf);
  },
  [tabDragging],
);

const handleContentPointerUp = useCallback(() => {
  if (tabDragging && showDropZone && draggingTabId && draggingTabId !== activeTabId) {
    setSplitTabId(draggingTabId);
  }
  setShowDropZone(false);
}, [tabDragging, showDropZone, draggingTabId, activeTabId]);
```

**Step 4: 退出分屏的回调**

```typescript
const handleCloseSplit = useCallback(() => {
  setSplitTabId(null);
  setSplitRatio(0.5);
}, []);
```

**Step 5: 关闭 tab 时清理分屏**

在 `handleCloseTab`（约第 60 行）中，添加分屏清理逻辑：

```typescript
// 在 setTerminalActivated 之前添加
if (tabId === splitTabId) {
  setSplitTabId(null);
  setSplitRatio(0.5);
}
```

需要将 `splitTabId` 加入 `handleCloseTab` 的依赖：`[activeTabId, splitTabId]`

**Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: App 添加分屏状态管理和 drop zone 逻辑"
```

---

### Task 4: App.tsx 渲染分屏布局

**Files:**
- Modify: `src/App.tsx`

**Step 1: 导入 SplitDivider**

在文件顶部 import 区域添加：
```typescript
import SplitDivider from "./components/SplitDivider";
```

**Step 2: 传递新 props 给 TabBar**

修改 TabBar 调用（约第 332-340 行）：

```tsx
<TabBar
  tabs={tabs}
  activeTabId={activeTabId}
  splitTabId={splitTabId}
  onSelectTab={handleSelectTab}
  onCloseTab={handleCloseTab}
  onNewTab={handleNewTab}
  onReorderTabs={handleReorderTabs}
  onDragStateChange={handleTabDragStateChange}
/>
```

**Step 3: 改造主内容区域支持分屏**

将 `{/* Main content area */}` 下的 `<div className="flex-1 relative overflow-hidden">` 改为支持分屏的结构。

核心思路：当 `splitTabId` 存在时，主内容区变为 flex 横向布局，左右各一个面板。

在主内容 div 上增加 pointer 事件监听（用于检测 drop zone）：

```tsx
<div
  className="flex-1 relative overflow-hidden"
  onPointerMove={handleContentDragOver}
  onPointerUp={handleContentPointerUp}
>
```

**当 splitTabId 为 null（正常模式）时：** 保持原有渲染逻辑不变。

**当 splitTabId 不为 null（分屏模式）时：** 渲染分屏布局：

```tsx
{splitTabId && (
  <div className="absolute inset-0 flex">
    {/* 左侧面板 */}
    <div className="relative overflow-hidden" style={{ width: `calc(${splitRatio * 100}% - 2px)` }}>
      {/* 渲染 activeTabId 对应的 LiveTerminal */}
      {tabs
        .filter((tab) => terminalActivated.has(tab.id) && tab.id === activeTabId && tab.mode === "terminal")
        .map((tab) => (
          <div key={`split-left-${tab.id}`} className="absolute inset-0 flex flex-col">
            <div className="flex-1 overflow-hidden">
              <LiveTerminal
                workingDir={tab.workingDir}
                yolo={tab.yolo}
                tool={tab.tool}
                onSessionStarted={(sessionId) => handleSessionStarted(tab.id, sessionId)}
                onError={() => updateTabStatus(tab.id, "error")}
              />
            </div>
          </div>
        ))}
    </div>

    <SplitDivider onRatioChange={setSplitRatio} />

    {/* 右侧面板 */}
    <div className="relative overflow-hidden flex-1">
      {/* 关闭分屏按钮 */}
      <button
        onClick={handleCloseSplit}
        className="absolute top-1 right-1 z-10 w-5 h-5 flex items-center justify-center rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
        title="Close split"
      >
        ✕
      </button>
      {/* 渲染 splitTabId 对应的 LiveTerminal */}
      {tabs
        .filter((tab) => terminalActivated.has(tab.id) && tab.id === splitTabId && tab.mode === "terminal")
        .map((tab) => (
          <div key={`split-right-${tab.id}`} className="absolute inset-0 flex flex-col">
            <div className="flex-1 overflow-hidden">
              <LiveTerminal
                workingDir={tab.workingDir}
                yolo={tab.yolo}
                tool={tab.tool}
                onSessionStarted={(sessionId) => handleSessionStarted(tab.id, sessionId)}
                onError={() => updateTabStatus(tab.id, "error")}
              />
            </div>
          </div>
        ))}
    </div>
  </div>
)}
```

**重要注意：** 分屏模式下的 LiveTerminal 不能是新实例（否则会创建新 PTY 会话）。这里有个关键问题：当前每个 tab 的 LiveTerminal 是通过 `key={tab.id}` 渲染在一个列表里的，切换到分屏布局时如果 key 变了或者 DOM 位置变了，React 会卸载重建组件。

**解决方案：** 不创建新的分屏渲染结构，而是修改现有终端列表的 CSS 定位。分屏时，让两个终端都设为 `display: flex`，但通过 `style` 控制它们的位置和宽度：

- 左侧终端：`left:0, width: splitRatio * 100% - 2px`
- 右侧终端：`right:0, width: (1 - splitRatio) * 100% - 2px`

这样不改变 React 组件树结构，只改 CSS 属性，LiveTerminal 不会重建。

修改现有终端渲染逻辑（约第 395-413 行）：

```tsx
{/* Terminal mode tabs - only mount if terminal was ever activated */}
{tabs
  .filter((tab) => terminalActivated.has(tab.id))
  .map((tab) => {
    const isActive = tab.id === activeTabId && tab.mode === "terminal";
    const isSplit = tab.id === splitTabId && tab.mode === "terminal";
    const visible = isActive || isSplit;

    // 分屏模式下的位置样式
    let posStyle: React.CSSProperties = {};
    if (splitTabId) {
      if (isActive) {
        posStyle = { left: 0, width: `calc(${splitRatio * 100}% - 2px)`, right: "auto" };
      } else if (isSplit) {
        posStyle = { right: 0, width: `calc(${(1 - splitRatio) * 100}% - 2px)`, left: "auto" };
      }
    }

    return (
      <div
        key={`term-${tab.id}`}
        className="absolute inset-0 flex flex-col"
        style={{ display: visible ? "flex" : "none", ...posStyle }}
      >
        <div className="flex-1 overflow-hidden">
          <LiveTerminal
            workingDir={tab.workingDir}
            yolo={tab.yolo}
            tool={tab.tool}
            onSessionStarted={(sessionId) => handleSessionStarted(tab.id, sessionId)}
            onError={() => updateTabStatus(tab.id, "error")}
          />
        </div>
      </div>
    );
  })}

{/* 分屏分隔线 */}
{splitTabId && (
  <div
    className="absolute top-0 bottom-0 z-10"
    style={{ left: `calc(${splitRatio * 100}% - 2px)` }}
  >
    <SplitDivider onRatioChange={setSplitRatio} />
  </div>
)}

{/* 分屏关闭按钮 */}
{splitTabId && (
  <button
    onClick={handleCloseSplit}
    className="absolute top-1 z-10 w-5 h-5 flex items-center justify-center rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
    style={{ right: 4 }}
    title="Close split"
  >
    ✕
  </button>
)}
```

**Step 4: Drop zone 高亮指示器**

在主内容 div 内、终端列表之前添加：

```tsx
{/* 分屏 drop zone 高亮 */}
{tabDragging && showDropZone && (
  <div className="absolute inset-y-0 right-0 w-1/2 z-20 bg-[var(--accent-cyan)]/10 border-2 border-dashed border-[var(--accent-cyan)] rounded-r-lg pointer-events-none flex items-center justify-center">
    <span className="text-sm text-[var(--accent-cyan)] font-medium">Split Right</span>
  </div>
)}
```

**Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: 实现终端分屏布局，拖拽 tab 到右侧触发分屏"
```

---

### Task 5: 调整 SplitDivider 定位为 absolute 模式

**Files:**
- Modify: `src/components/SplitDivider.tsx`

SplitDivider 在 Task 4 中变成了 absolute 定位的覆盖层，需要调整为 absolute 模式下正确工作。

**Step 1: 修改计算逻辑**

SplitDivider 现在是 absolute 定位在主内容区域上的，需要根据父容器的 grandparent（`flex-1 relative overflow-hidden`）来计算比例：

```tsx
export default function SplitDivider({ onRatioChange }: SplitDividerProps) {
  const dragging = useRef(false);
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      // 获取主内容区域的边界（divider 的祖父容器）
      const contentArea = dividerRef.current?.parentElement?.parentElement;
      if (!contentArea) return;
      const rect = contentArea.getBoundingClientRect();

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        let ratio = (ev.clientX - rect.left) / rect.width;
        ratio = Math.max(0.25, Math.min(0.75, ratio));
        onRatioChange(ratio);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onRatioChange],
  );

  return (
    <div
      ref={dividerRef}
      onMouseDown={handleMouseDown}
      className="w-1 h-full shrink-0 cursor-col-resize bg-[var(--border-subtle)] hover:bg-[var(--accent-cyan)] transition-colors duration-150"
    />
  );
}
```

**Step 2: Commit**

```bash
git add src/components/SplitDivider.tsx
git commit -m "fix: SplitDivider 适配 absolute 定位模式的比例计算"
```

---

### Task 6: 验证和修复

**Step 1: 编译检查**

Run: `cd /Users/senguoyun/Desktop/demotry/claudedesktop && npx tsc --noEmit`
Expected: 无类型错误

**Step 2: 开发模式验证**

Run: `npm run dev`
Expected: 应用正常启动

**Step 3: 手动测试清单**

1. 打开两个 tab，各自启动终端
2. 拖拽第二个 tab 到主内容区域右半部分 → 应出现蓝色高亮
3. 松手 → 应进入分屏模式，左右各显示一个终端
4. 拖拽中间分隔线 → 左右比例应跟随变化
5. 两个终端都能正常输入输出
6. 点击右侧 ✕ → 退出分屏，恢复单终端视图
7. 关闭右侧分屏的 tab → 应自动退出分屏
8. Tab 栏中分屏的 tab 应显示标记图标

**Step 4: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: 分屏功能验证修复"
```
