import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const launchpadLifecycle = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../src/components/Sidebar", () => ({
  default: () => <div data-testid="sidebar" />,
}));

vi.mock("../src/components/StatusBar", () => ({
  default: () => <div data-testid="status-bar" />,
}));

vi.mock("../src/components/BranchSwitcher", () => ({
  default: () => <div data-testid="branch-switcher" />,
}));

vi.mock("../src/components/TabBar", () => ({
  default: () => <div data-testid="tab-bar" />,
}));

vi.mock("../src/components/SplitDivider", () => ({
  default: () => <div data-testid="split-divider" />,
}));

vi.mock("../src/components/BugTrackerPanel", () => ({
  default: () => <div data-testid="bug-tracker-panel" />,
}));

vi.mock("../src/components/ChatArea", () => ({
  default: () => <div data-testid="chat-area" />,
}));

vi.mock("../src/components/CodexUsagePanel", () => ({
  default: () => <div data-testid="api-use-panel">API Use</div>,
}));

vi.mock("../src/components/CommitHistory", () => ({
  default: () => <div data-testid="commit-history" />,
}));

vi.mock("../src/components/FileTree", () => ({
  default: () => <div data-testid="file-tree" />,
}));

vi.mock("../src/components/LaunchpadPanel", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: function MockLaunchpadPanel() {
      React.useEffect(() => {
        launchpadLifecycle.mounts += 1;
        return () => {
          launchpadLifecycle.unmounts += 1;
        };
      }, []);

      return <div data-testid="launchpad-panel">Launchpad 内容</div>;
    },
  };
});

vi.mock("../src/components/LiveTerminal", () => ({
  default: () => <div data-testid="live-terminal" />,
}));

vi.mock("../src/components/QuickActionsPanel", () => ({
  default: () => <div data-testid="quick-actions-panel" />,
}));

vi.mock("../src/components/SkillsPanel", () => ({
  default: () => <div data-testid="skills-panel" />,
}));

describe("App Launchpad 面板", () => {
  beforeEach(() => {
    launchpadLifecycle.mounts = 0;
    launchpadLifecycle.unmounts = 0;
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("切到 API Use 后不卸载 Launchpad，避免运行内容被清空", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Launchpad" }));
    expect(await screen.findByTestId("launchpad-panel")).toBeInTheDocument();
    expect(launchpadLifecycle.mounts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "API Use" }));
    expect(await screen.findByTestId("api-use-panel")).toBeInTheDocument();

    await waitFor(() => {
      expect(launchpadLifecycle.unmounts).toBe(0);
    });
    expect(screen.getByTestId("launchpad-panel")).toBeInTheDocument();
  });

  it("关闭 API Use 后回到原来的 Launchpad", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Launchpad" }));
    expect(await screen.findByText("Project Launchpad")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "API Use" }));
    expect(await screen.findByText("Codex API Usage")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "API Use" }));
    expect(await screen.findByText("Project Launchpad")).toBeInTheDocument();
    expect(launchpadLifecycle.unmounts).toBe(0);
  });

  it("切到 Skills 后不卸载 Launchpad，关闭 Skills 后仍回到 Launchpad", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Launchpad" }));
    expect(await screen.findByTestId("launchpad-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(await screen.findByText("Skills 使用看板")).toBeInTheDocument();

    await waitFor(() => {
      expect(launchpadLifecycle.unmounts).toBe(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(await screen.findByText("Project Launchpad")).toBeInTheDocument();
    expect(screen.getByTestId("launchpad-panel")).toBeInTheDocument();
  });
});
