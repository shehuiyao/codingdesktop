import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ViewMode = "day" | "week" | "month";

interface CodexUsageItem {
  date: string;
  hour: number;
  project: string;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}

interface CodexSpeedItem {
  date: string;
  hour: number;
  project: string;
  duration: number;
}

interface CodexUsageReport {
  usage: CodexUsageItem[];
  speed: CodexSpeedItem[];
  generatedAt: string;
  roots: string[];
}

interface Bucket {
  label: string;
  turns: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
  durations: number[];
}

const EMPTY_REPORT: CodexUsageReport = {
  usage: [],
  speed: [],
  generatedAt: "",
  roots: [],
};

function todayKey() {
  const now = new Date();
  return dateKey(now);
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function rangeFor(mode: ViewMode, selectedDate: string): [Date, Date] {
  const selected = parseDate(selectedDate);
  if (mode === "day") return [selected, selected];
  if (mode === "week") {
    const monday = addDays(selected, (selected.getDay() || 7) * -1 + 1);
    return [monday, addDays(monday, 6)];
  }
  return [new Date(selected.getFullYear(), selected.getMonth(), 1), new Date(selected.getFullYear(), selected.getMonth() + 1, 0)];
}

function inRange(date: string, start: Date, end: Date) {
  const target = parseDate(date);
  return target >= start && target <= end;
}

function emptyBucket(label: string): Bucket {
  return {
    label,
    turns: 0,
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    total: 0,
    durations: [],
  };
}

function addUsage(bucket: Bucket, item: CodexUsageItem) {
  bucket.turns += 1;
  bucket.input += item.input || 0;
  bucket.cached += item.cached || 0;
  bucket.output += item.output || 0;
  bucket.reasoning += item.reasoning || 0;
  bucket.total += item.total || 0;
}

function average(values: number[]) {
  if (values.length === 0) return NaN;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function formatTokens(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 60) return `${(value / 60).toFixed(1)} 分`;
  return `${value.toFixed(1)} 秒`;
}

function bucketLabel(mode: ViewMode, item: { date: string; hour: number }) {
  if (mode === "day") return `${String(item.hour).padStart(2, "0")}:00`;
  return item.date.slice(5);
}

function buildBuckets(mode: ViewMode, selectedDate: string, usage: CodexUsageItem[], speed: CodexSpeedItem[]) {
  const [start, end] = rangeFor(mode, selectedDate);
  const buckets = new Map<string, Bucket>();

  if (mode === "day") {
    for (let hour = 0; hour < 24; hour += 1) {
      const label = `${String(hour).padStart(2, "0")}:00`;
      buckets.set(label, emptyBucket(label));
    }
  } else {
    for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
      const label = dateKey(date).slice(5);
      buckets.set(label, emptyBucket(label));
    }
  }

  usage.forEach((item) => {
    const label = bucketLabel(mode, item);
    if (!buckets.has(label)) buckets.set(label, emptyBucket(label));
    addUsage(buckets.get(label)!, item);
  });

  speed.forEach((item) => {
    const label = bucketLabel(mode, item);
    if (!buckets.has(label)) buckets.set(label, emptyBucket(label));
    buckets.get(label)!.durations.push(item.duration);
  });

  return Array.from(buckets.values());
}

function sumUsage(items: CodexUsageItem[]) {
  const bucket = emptyBucket("");
  items.forEach((item) => addUsage(bucket, item));
  return bucket;
}

function makeLinePath(points: Bucket[], key: "total" | "output" | "avgDuration", width: number, height: number, baseY: number) {
  const values = points.map((point) => key === "avgDuration" ? average(point.durations) || 0 : point[key]);
  const max = Math.max(...values, 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  return values.map((value, index) => {
    const x = 42 + index * step;
    const y = baseY - (value / max) * height;
    return `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function UsageChart({ points }: { points: Bucket[] }) {
  const width = 700;
  const height = 210;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const max = Math.max(...points.map((point) => point.total), 1);
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));

  return (
    <svg viewBox="0 0 790 310" className="w-full min-h-[220px]">
      <line x1="38" y1="252" x2="760" y2="252" stroke="var(--border-color)" />
      <path d={makeLinePath(points, "total", width, height, 252)} fill="none" stroke="var(--accent-cyan)" strokeWidth="3" />
      <path d={makeLinePath(points, "output", width, height, 252)} fill="none" stroke="var(--accent-orange)" strokeWidth="2" />
      {points.map((point, index) => {
        const x = 42 + index * step;
        const y = 252 - (point.total / max) * height;
        return (
          <g key={point.label}>
            <circle cx={x} cy={y} r="4" fill="var(--bg-secondary)" stroke="var(--accent-cyan)" strokeWidth="2">
              <title>{`${point.label}\n总量 ${formatTokens(point.total)}\n输出 ${formatTokens(point.output)}`}</title>
            </circle>
            {index % labelEvery === 0 && (
              <text x={x} y="292" textAnchor="middle" fill="var(--text-muted)" fontSize="11">{point.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SpeedChart({ points }: { points: Bucket[] }) {
  const width = 700;
  const height = 190;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const values = points.map((point) => average(point.durations) || 0);
  const max = Math.max(...values, 1);
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));

  return (
    <svg viewBox="0 0 790 280" className="w-full min-h-[200px]">
      <line x1="38" y1="232" x2="760" y2="232" stroke="var(--border-color)" />
      <path d={makeLinePath(points, "avgDuration", width, height, 232)} fill="none" stroke="var(--accent-blue)" strokeWidth="3" />
      {points.map((point, index) => {
        const avg = values[index];
        const x = 42 + index * step;
        const y = 232 - (avg / max) * height;
        const longest = Math.max(...point.durations, 0);
        return (
          <g key={point.label}>
            <circle cx={x} cy={y} r="5" fill="var(--bg-secondary)" stroke="var(--accent-blue)" strokeWidth="2">
              <title>{`${point.label}\n平均耗时 ${formatSeconds(avg)}\n可计算轮数 ${point.durations.length}\n最长一轮 ${formatSeconds(longest)}`}</title>
            </circle>
            {index % labelEvery === 0 && (
              <text x={x} y="266" textAnchor="middle" fill="var(--text-muted)" fontSize="11">{point.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function CodexUsagePanel() {
  const [report, setReport] = useState<CodexUsageReport>(EMPTY_REPORT);
  const [mode, setMode] = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [selectedProject, setSelectedProject] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await invoke<CodexUsageReport>("get_codex_usage");
      setReport(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const projects = useMemo(() => {
    const names = Array.from(new Set(report.usage.map((item) => item.project).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    return ["all", ...names];
  }, [report.usage]);

  const [start, end] = useMemo(() => rangeFor(mode, selectedDate), [mode, selectedDate]);

  const filteredUsage = useMemo(
    () => report.usage.filter((item) => inRange(item.date, start, end) && (selectedProject === "all" || item.project === selectedProject)),
    [end, report.usage, selectedProject, start],
  );
  const filteredSpeed = useMemo(
    () => report.speed.filter((item) => inRange(item.date, start, end) && (selectedProject === "all" || item.project === selectedProject)),
    [end, report.speed, selectedProject, start],
  );
  const buckets = useMemo(() => buildBuckets(mode, selectedDate, filteredUsage, filteredSpeed), [filteredSpeed, filteredUsage, mode, selectedDate]);
  const totals = useMemo(() => sumUsage(filteredUsage), [filteredUsage]);
  const durations = filteredSpeed.map((item) => item.duration);
  const avgDuration = average(durations);

  const projectRows = useMemo(() => {
    const map = new Map<string, Bucket>();
    filteredUsage.forEach((item) => {
      if (!map.has(item.project)) map.set(item.project, emptyBucket(item.project));
      addUsage(map.get(item.project)!, item);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filteredUsage]);
  const maxProjectTotal = Math.max(...projectRows.map((item) => item.total), 1);

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(57,210,192,0.08),transparent_32%),var(--bg-primary)]">
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 px-5 py-4 mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Codex API 用量</h1>
            <div className="mt-1 text-xs text-[var(--text-muted)] truncate">
              {report.generatedAt ? `更新于 ${new Date(report.generatedAt).toLocaleString("zh-CN")}` : "等待刷新"}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="px-3 py-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-secondary)]">
              {filteredUsage.length} 条事件
            </span>
            <button
              onClick={refresh}
              disabled={loading}
              className="px-4 py-1.5 rounded-xl bg-[var(--accent-cyan)] text-[#0d1117] text-xs font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-default cursor-pointer transition-all"
            >
              {loading ? "刷新中" : "刷新"}
            </button>
          </div>
        </div>

        <div className="sticky top-0 z-20 mb-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/88 backdrop-blur px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-xl border border-[var(--border-color)] overflow-hidden bg-[var(--bg-secondary)]">
            {(["day", "week", "month"] as ViewMode[]).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={`h-8 px-4 text-xs cursor-pointer transition-colors ${
                  mode === item ? "bg-[var(--accent-cyan)] text-[#0d1117]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {item === "day" ? "日" : item === "week" ? "周" : "月"}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="h-8 px-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] outline-none"
          />
          <div className="relative">
            <select
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
              className="appearance-none h-8 min-w-[180px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] pl-3 pr-8 text-xs text-[var(--text-primary)] outline-none cursor-pointer"
            >
              {projects.map((project) => (
                <option key={project} value={project} className="bg-[var(--bg-primary)] text-[var(--text-primary)]">
                  {project === "all" ? "全部项目" : project}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">▼</span>
          </div>
          <button
            onClick={() => setSelectedDate(todayKey())}
            className="h-8 px-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          >
            今天
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-[var(--accent-red)]/35 bg-[var(--accent-red)]/10 px-4 py-3 text-sm text-[var(--accent-red)]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
          {[
            ["总量", formatTokens(totals.total), `${dateKey(start)} ~ ${dateKey(end)}`],
            ["非缓存粗略量", formatTokens(Math.max(totals.total - totals.cached, 0)), "总量减缓存输入"],
            ["输出", formatTokens(totals.output), "回答与工具输出相关"],
            ["请求次数", new Intl.NumberFormat("zh-CN").format(totals.turns), "token_count 事件数"],
            ["平均耗时", formatSeconds(avgDuration), `${durations.length} 轮可计算`],
          ].map(([label, value, sub]) => (
            <div key={label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4 min-w-0">
              <div className="text-xs text-[var(--text-muted)] mb-2">{label}</div>
              <div className="text-xl font-semibold text-[var(--text-primary)] truncate">{value}</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-2 truncate">{sub}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.9fr] gap-4 mb-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-medium text-[var(--text-primary)]">用量折线</h2>
              <span className="text-[11px] text-[var(--text-muted)]">总量 / 输出</span>
            </div>
            <UsageChart points={buckets} />
          </div>

          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-medium text-[var(--text-primary)]">项目用量</h2>
              <span className="text-[11px] text-[var(--text-muted)]">Top 10</span>
            </div>
            <div className="space-y-3">
              {projectRows.length === 0 ? (
                <div className="text-sm text-[var(--text-muted)] py-8 text-center">没有数据</div>
              ) : projectRows.map((item) => (
                <div key={item.label} className="grid grid-cols-[minmax(96px,1fr)_minmax(120px,2fr)_auto] gap-3 items-center text-xs">
                  <div className="truncate text-[var(--text-secondary)]" title={item.label}>{item.label}</div>
                  <div className="h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--accent-orange)]" style={{ width: `${(item.total / maxProjectTotal) * 100}%` }} />
                  </div>
                  <div className="text-[var(--text-primary)] tabular-nums">{formatTokens(item.total)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.9fr] gap-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-medium text-[var(--text-primary)]">响应耗时</h2>
              <span className="text-[11px] text-[var(--text-muted)]">越低越快</span>
            </div>
            <SpeedChart points={buckets} />
          </div>

          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-medium text-[var(--text-primary)]">明细表</h2>
              <span className="text-[11px] text-[var(--text-muted)]">{buckets.length} 个时间点</span>
            </div>
            <div className="overflow-auto max-h-[320px]">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-[var(--bg-secondary)]">
                  <tr className="text-[var(--text-muted)]">
                    <th className="text-left font-medium py-2 pr-3 border-b border-[var(--border-color)]">时间</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-[var(--border-color)]">次数</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-[var(--border-color)]">总量</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-[var(--border-color)]">缓存</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-[var(--border-color)]">输出</th>
                    <th className="text-right font-medium py-2 pl-3 border-b border-[var(--border-color)]">平均耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((bucket) => (
                    <tr key={bucket.label} className="text-[var(--text-secondary)]">
                      <td className="py-2 pr-3 border-b border-[var(--border-subtle)]">{bucket.label}</td>
                      <td className="text-right py-2 px-3 border-b border-[var(--border-subtle)] tabular-nums">{bucket.turns}</td>
                      <td className="text-right py-2 px-3 border-b border-[var(--border-subtle)] tabular-nums">{formatTokens(bucket.total)}</td>
                      <td className="text-right py-2 px-3 border-b border-[var(--border-subtle)] tabular-nums">{formatTokens(bucket.cached)}</td>
                      <td className="text-right py-2 px-3 border-b border-[var(--border-subtle)] tabular-nums">{formatTokens(bucket.output)}</td>
                      <td className="text-right py-2 pl-3 border-b border-[var(--border-subtle)] tabular-nums">{formatSeconds(average(bucket.durations))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {report.roots.length > 0 && (
          <div className="mt-4 text-[11px] text-[var(--text-muted)] truncate" title={report.roots.join("\n")}>
            数据来源：{report.roots.join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}
