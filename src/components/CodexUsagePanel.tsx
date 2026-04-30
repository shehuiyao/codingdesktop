import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

type ViewMode = "day" | "week" | "month";
type ChartMode = "line" | "scatter";

interface CodexUsageItem {
  date: string;
  hour: number;
  timestamp?: string;
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
  timestamp?: string;
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

interface ActivityDay {
  date: string;
  month: string;
  turns: number;
  input: number;
  cached: number;
  total: number;
  output: number;
  reasoning: number;
  level: number;
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

function formatActivityDate(value: string) {
  return parseDate(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatActivityDateTitle(value: string) {
  return parseDate(value).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
}

function formatEventTime(item: { timestamp?: string; date: string; hour: number }) {
  const time = item.timestamp ? new Date(item.timestamp) : new Date(parseDate(item.date).getTime() + item.hour * 60 * 60 * 1000);
  if (Number.isNaN(time.getTime())) return `${item.date} ${String(item.hour).padStart(2, "0")}:00`;
  return time.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSourceLabel(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const area = normalized.includes("/tmp/codex-subscription-home/.codex") ? "订阅隔离" : normalized.includes("/.codex/") ? "主目录" : "本地目录";

  if (normalized.endsWith("/archived_sessions")) return `${area}归档`;
  if (normalized.endsWith("/sessions")) return `${area}会话`;
  return area;
}

function formatSourceSummary(roots: string[]) {
  return Array.from(new Set(roots.map(formatSourceLabel))).join(" · ");
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

function buildActivityDays(selectedDate: string, usage: CodexUsageItem[], weeks = 18) {
  const end = parseDate(selectedDate);
  const endOffset = end.getDay();
  const gridEnd = addDays(end, 6 - endOffset);
  const gridStart = addDays(gridEnd, -(weeks * 7 - 1));
  const byDate = new Map<string, Bucket>();

  usage.forEach((item) => {
    if (!byDate.has(item.date)) byDate.set(item.date, emptyBucket(item.date));
    addUsage(byDate.get(item.date)!, item);
  });

  const maxTotal = Math.max(...Array.from(byDate.values()).map((item) => item.total), 1);
  const days: ActivityDay[] = [];

  for (let date = new Date(gridStart); date <= gridEnd; date = addDays(date, 1)) {
    const key = dateKey(date);
    const bucket = byDate.get(key) ?? emptyBucket(key);
    const level = bucket.total === 0 ? 0 : Math.max(1, Math.ceil((bucket.total / maxTotal) * 4));
    days.push({
      date: key,
      month: date.toLocaleDateString("zh-CN", { month: "short" }),
      turns: bucket.turns,
      input: bucket.input,
      cached: bucket.cached,
      total: bucket.total,
      output: bucket.output,
      reasoning: bucket.reasoning,
      level,
    });
  }

  return days;
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

function itemTimeValue(item: CodexUsageItem) {
  const parsed = item.timestamp ? new Date(item.timestamp).getTime() : NaN;
  if (Number.isFinite(parsed)) return parsed;
  return parseDate(item.date).getTime() + item.hour * 60 * 60 * 1000;
}

function speedTimeValue(item: CodexSpeedItem) {
  const parsed = item.timestamp ? new Date(item.timestamp).getTime() : NaN;
  if (Number.isFinite(parsed)) return parsed;
  return parseDate(item.date).getTime() + item.hour * 60 * 60 * 1000;
}

function rangeTimeFor(mode: ViewMode, selectedDate: string) {
  const [startDate, endDate] = rangeFor(mode, selectedDate);
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  return [start.getTime(), end.getTime()] as const;
}

function ChartTooltip({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[170px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-[0_16px_38px_var(--shadow-color)]"
      style={{
        left: `${(x / 790) * 100}%`,
        top: `${(y / 310) * 100}%`,
        transform: "translate(-50%, calc(-100% - 10px))",
      }}
    >
      {children}
    </div>
  );
}

function ScatterUsageChart({
  items,
  mode,
  selectedDate,
}: {
  items: CodexUsageItem[];
  mode: ViewMode;
  selectedDate: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [start, end] = rangeTimeFor(mode, selectedDate);
  const width = 700;
  const height = 210;
  const baseY = 252;
  const max = Math.max(...items.map((item) => item.total), 1);
  const sortedItems = useMemo(() => [...items].sort((a, b) => itemTimeValue(a) - itemTimeValue(b)), [items]);
  const points = sortedItems.map((item) => {
    const time = itemTimeValue(item);
    const progress = end > start ? (time - start) / (end - start) : 0;
    return {
      item,
      x: 42 + Math.min(Math.max(progress, 0), 1) * width,
      y: baseY - (item.total / max) * height,
    };
  });
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  const guideLabels = mode === "day"
    ? ["00:00", "06:00", "12:00", "18:00", "24:00"]
    : Array.from({ length: Math.min(6, Math.max(2, points.length || 6)) }, (_, index) => {
        const tick = new Date(start + ((end - start) * index) / (Math.min(6, Math.max(2, points.length || 6)) - 1));
        return tick.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
      });

  return (
    <div className="relative" onMouseLeave={() => setHoverIndex(null)}>
      <svg viewBox="0 0 790 310" className="w-full min-h-[220px]">
        <line x1="38" y1="252" x2="760" y2="252" stroke="var(--border-color)" />
        {guideLabels.map((label, index) => {
          const x = 42 + (index / Math.max(guideLabels.length - 1, 1)) * width;
          return (
            <g key={`${label}-${index}`}>
              <line x1={x} y1="36" x2={x} y2="252" stroke="var(--border-subtle)" strokeDasharray="3 8" />
              <text x={x} y="292" textAnchor="middle" fill="var(--text-muted)" fontSize="11">{label}</text>
            </g>
          );
        })}
        {hoverPoint && (
          <line x1={hoverPoint.x} y1="34" x2={hoverPoint.x} y2="252" stroke="var(--border-color)" strokeDasharray="4 4" />
        )}
        {points.length === 0 ? (
          <text x="400" y="150" textAnchor="middle" fill="var(--text-muted)" fontSize="12">没有可绘制的事件</text>
        ) : points.map((point, index) => {
          const isHover = hoverIndex === index;
          const radius = isHover ? 6 : Math.min(5, Math.max(3, 2.5 + (point.item.output / Math.max(point.item.total, 1)) * 4));
          return (
            <g key={`${point.item.timestamp ?? point.item.date}-${point.item.project}-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r="10"
                fill="transparent"
                onMouseEnter={() => setHoverIndex(index)}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={radius}
                fill={isHover ? "var(--accent-cyan)" : "var(--bg-secondary)"}
                stroke="var(--accent-cyan)"
                strokeWidth="2"
                opacity={isHover ? 1 : 0.82}
                onMouseEnter={() => setHoverIndex(index)}
              />
            </g>
          );
        })}
      </svg>
      {hoverPoint && (
        <ChartTooltip x={hoverPoint.x} y={Math.max(52, hoverPoint.y)}>
          <div className="mb-1 font-medium text-[var(--text-primary)]">{formatEventTime(hoverPoint.item)}</div>
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <span>项目</span><span className="max-w-[140px] truncate text-right text-[var(--text-primary)]" title={hoverPoint.item.project}>{hoverPoint.item.project}</span>
            <span>总量</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoverPoint.item.total)}</span>
            <span>输入</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoverPoint.item.input)}</span>
            <span>缓存</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoverPoint.item.cached)}</span>
            <span>输出</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoverPoint.item.output)}</span>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

function ScatterSpeedChart({
  items,
  mode,
  selectedDate,
}: {
  items: CodexSpeedItem[];
  mode: ViewMode;
  selectedDate: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [start, end] = rangeTimeFor(mode, selectedDate);
  const width = 700;
  const height = 190;
  const baseY = 232;
  const max = Math.max(...items.map((item) => item.duration), 1);
  const sortedItems = useMemo(() => [...items].sort((a, b) => speedTimeValue(a) - speedTimeValue(b)), [items]);
  const points = sortedItems.map((item) => {
    const time = speedTimeValue(item);
    const progress = end > start ? (time - start) / (end - start) : 0;
    return {
      item,
      x: 42 + Math.min(Math.max(progress, 0), 1) * width,
      y: baseY - (item.duration / max) * height,
    };
  });
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  const guideLabels = mode === "day"
    ? ["00:00", "06:00", "12:00", "18:00", "24:00"]
    : Array.from({ length: Math.min(6, Math.max(2, points.length || 6)) }, (_, index) => {
        const tick = new Date(start + ((end - start) * index) / (Math.min(6, Math.max(2, points.length || 6)) - 1));
        return tick.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
      });

  return (
    <div className="relative" onMouseLeave={() => setHoverIndex(null)}>
      <svg viewBox="0 0 790 280" className="w-full min-h-[200px]">
        <line x1="38" y1="232" x2="760" y2="232" stroke="var(--border-color)" />
        {guideLabels.map((label, index) => {
          const x = 42 + (index / Math.max(guideLabels.length - 1, 1)) * width;
          return (
            <g key={`${label}-${index}`}>
              <line x1={x} y1="36" x2={x} y2="232" stroke="var(--border-subtle)" strokeDasharray="3 8" />
              <text x={x} y="266" textAnchor="middle" fill="var(--text-muted)" fontSize="11">{label}</text>
            </g>
          );
        })}
        {hoverPoint && (
          <>
            <line x1={hoverPoint.x} y1="34" x2={hoverPoint.x} y2="232" stroke="var(--border-color)" strokeDasharray="4 4" />
            <line x1="38" y1={hoverPoint.y} x2="760" y2={hoverPoint.y} stroke="var(--border-subtle)" strokeDasharray="4 6" />
          </>
        )}
        {points.length === 0 ? (
          <text x="400" y="138" textAnchor="middle" fill="var(--text-muted)" fontSize="12">没有可绘制的耗时事件</text>
        ) : points.map((point, index) => {
          const isHover = hoverIndex === index;
          const radius = isHover ? 7 : Math.min(5.5, Math.max(3.2, 3 + (point.item.duration / max) * 3));
          return (
            <g key={`${point.item.timestamp ?? point.item.date}-${point.item.project}-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r="10"
                fill="transparent"
                onMouseEnter={() => setHoverIndex(index)}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={radius}
                fill={isHover ? "var(--accent-blue)" : "var(--bg-secondary)"}
                stroke="var(--accent-blue)"
                strokeWidth="2"
                opacity={isHover ? 1 : 0.82}
                onMouseEnter={() => setHoverIndex(index)}
              />
            </g>
          );
        })}
      </svg>
      {hoverPoint && (
        <ChartTooltip x={hoverPoint.x} y={Math.max(52, hoverPoint.y)}>
          <div className="mb-1 font-medium text-[var(--text-primary)]">{formatEventTime(hoverPoint.item)}</div>
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <span>项目</span><span className="max-w-[140px] truncate text-right text-[var(--text-primary)]" title={hoverPoint.item.project}>{hoverPoint.item.project}</span>
            <span>耗时</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatSeconds(hoverPoint.item.duration)}</span>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

function UsageChart({ points }: { points: Bucket[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 700;
  const height = 210;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const max = Math.max(...points.map((point) => point.total), 1);
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  const hoverX = hoverIndex === null ? 0 : 42 + hoverIndex * step;
  const hoverY = hoverPoint ? 252 - (hoverPoint.total / max) * height : 0;

  return (
    <div className="relative" onMouseLeave={() => setHoverIndex(null)}>
      <svg viewBox="0 0 790 310" className="w-full min-h-[220px]">
        <line x1="38" y1="252" x2="760" y2="252" stroke="var(--border-color)" />
        {hoverPoint && (
          <line x1={hoverX} y1="34" x2={hoverX} y2="252" stroke="var(--border-color)" strokeDasharray="4 4" />
        )}
        <path d={makeLinePath(points, "total", width, height, 252)} fill="none" stroke="var(--accent-cyan)" strokeWidth="3" />
        <path d={makeLinePath(points, "output", width, height, 252)} fill="none" stroke="var(--accent-orange)" strokeWidth="2.5" strokeDasharray="7 5" />
        {points.map((point, index) => {
          const x = 42 + index * step;
          const y = 252 - (point.total / max) * height;
          const isHover = hoverIndex === index;
          return (
            <g key={point.label} onMouseEnter={() => setHoverIndex(index)}>
              <rect x={x - step / 2} y="20" width={Math.max(step, 18)} height="250" fill="transparent" />
              <circle cx={x} cy={y} r={isHover ? 6 : 4} fill="var(--bg-secondary)" stroke="var(--accent-cyan)" strokeWidth="2" />
              {index % labelEvery === 0 && (
                <text x={x} y="292" textAnchor="middle" fill="var(--text-muted)" fontSize="11">{point.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hoverPoint && (
        <ChartTooltip x={hoverX} y={Math.max(52, hoverY)}>
          <div className="mb-1 font-medium text-[var(--text-primary)]">{hoverPoint.label}</div>
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--accent-cyan)]" />总量</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoverPoint.total)}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--accent-orange)]" />输出</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoverPoint.output)}</span>
            <span>缓存</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoverPoint.cached)}</span>
            <span>请求</span><span className="text-right text-[var(--text-primary)] tabular-nums">{hoverPoint.turns}</span>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

function SpeedChart({ points }: { points: Bucket[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 700;
  const height = 190;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const values = points.map((point) => average(point.durations) || 0);
  const max = Math.max(...values, 1);
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  const hoverAvg = hoverIndex === null ? 0 : values[hoverIndex];
  const hoverX = hoverIndex === null ? 0 : 42 + hoverIndex * step;
  const hoverY = 232 - (hoverAvg / max) * height;
  const longest = hoverPoint ? Math.max(...hoverPoint.durations, 0) : 0;

  return (
    <div className="relative" onMouseLeave={() => setHoverIndex(null)}>
      <svg viewBox="0 0 790 280" className="w-full min-h-[200px]">
        <line x1="38" y1="232" x2="760" y2="232" stroke="var(--border-color)" />
        {hoverPoint && (
          <line x1={hoverX} y1="34" x2={hoverX} y2="232" stroke="var(--border-color)" strokeDasharray="4 4" />
        )}
        <path d={makeLinePath(points, "avgDuration", width, height, 232)} fill="none" stroke="var(--accent-blue)" strokeWidth="3" />
        {points.map((point, index) => {
          const avg = values[index];
          const x = 42 + index * step;
          const y = 232 - (avg / max) * height;
          const isHover = hoverIndex === index;
          return (
            <g key={point.label} onMouseEnter={() => setHoverIndex(index)}>
              <rect x={x - step / 2} y="20" width={Math.max(step, 18)} height="230" fill="transparent" />
              <circle cx={x} cy={y} r={isHover ? 7 : 5} fill="var(--bg-secondary)" stroke="var(--accent-blue)" strokeWidth="2" />
              {index % labelEvery === 0 && (
                <text x={x} y="266" textAnchor="middle" fill="var(--text-muted)" fontSize="11">{point.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hoverPoint && (
        <ChartTooltip x={hoverX} y={Math.max(52, hoverY)}>
          <div className="mb-1 font-medium text-[var(--text-primary)]">{hoverPoint.label}</div>
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <span>平均耗时</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatSeconds(hoverAvg)}</span>
            <span>可计算轮数</span><span className="text-right text-[var(--text-primary)] tabular-nums">{hoverPoint.durations.length}</span>
            <span>最长一轮</span><span className="text-right text-[var(--text-primary)] tabular-nums">{formatSeconds(longest)}</span>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

function ActivityHeatmap({ days }: { days: ActivityDay[] }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [hoveredDay, setHoveredDay] = useState<{ day: ActivityDay; x: number; y: number } | null>(null);
  const weeks = Math.ceil(days.length / 7);
  const monthLabels = days.reduce<{ month: string; column: number }[]>((labels, day, index) => {
    const column = Math.floor(index / 7);
    const isFirstInColumn = index % 7 === 0;
    const last = labels[labels.length - 1];
    if (isFirstInColumn && (!last || last.month !== day.month)) {
      labels.push({ month: day.month, column });
    }
    return labels;
  }, []);
  const totalTurns = days.reduce((sum, day) => sum + day.turns, 0);
  const activeDays = days.filter((day) => day.turns > 0).length;

  const updateHoveredDay = (event: MouseEvent<HTMLDivElement>, day: ActivityDay) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const horizontalPadding = Math.min(120, rect.width / 2);
    const x = Math.min(Math.max(event.clientX - rect.left, horizontalPadding), rect.width - horizontalPadding);
    const y = Math.max(event.clientY - rect.top, 96);
    setHoveredDay({ day, x, y });
  };

  return (
    <div
      ref={cardRef}
      className="relative rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4 min-w-0"
      onMouseLeave={() => setHoveredDay(null)}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-primary)]">活跃度</h2>
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">
            最近 {weeks} 周 · {activeDays} 天有使用 · {totalTurns} 次请求
          </div>
        </div>
        <span className="text-[11px] text-[var(--text-muted)]">按 token 总量着色</span>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-max">
          <div
            className="mb-1 grid h-4 text-[10px] text-[var(--text-muted)]"
            style={{ gridTemplateColumns: `repeat(${weeks}, 18px)`, columnGap: 6 }}
          >
            {monthLabels.map((item) => (
              <span key={`${item.month}-${item.column}`} style={{ gridColumnStart: item.column + 1 }}>
                {item.month}
              </span>
            ))}
          </div>
          <div
            className="grid grid-flow-col grid-rows-7 gap-1.5"
            style={{ gridTemplateColumns: `repeat(${weeks}, 18px)` }}
          >
            {days.map((day) => (
              <div
                key={day.date}
                className={`h-[18px] w-[18px] rounded-[4px] border border-[var(--activity-border)] ${
                  day.level === 0
                    ? "bg-[var(--bg-tertiary)]"
                    : day.level === 1
                      ? "bg-[var(--activity-level-1)]"
                      : day.level === 2
                        ? "bg-[var(--activity-level-2)]"
                        : day.level === 3
                          ? "bg-[var(--activity-level-3)]"
                          : "bg-[var(--activity-level-4)]"
                }`}
                aria-label={`${formatActivityDate(day.date)}，请求 ${day.turns} 次，总量 ${formatTokens(day.total)}，输出 ${formatTokens(day.output)}`}
                onMouseEnter={(event) => updateHoveredDay(event, day)}
                onMouseMove={(event) => updateHoveredDay(event, day)}
                onMouseLeave={() => setHoveredDay(null)}
              />
            ))}
          </div>
        </div>
      </div>

      {hoveredDay && (
        <div
          className="pointer-events-none absolute z-20 min-w-[210px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-[0_16px_38px_var(--shadow-color)]"
          style={{
            left: hoveredDay.x,
            top: hoveredDay.y,
            transform: "translate(-50%, calc(-100% - 12px))",
          }}
        >
          <div className="mb-1 font-medium text-[var(--text-primary)]">{formatActivityDateTitle(hoveredDay.day.date)}</div>
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <span>请求</span>
            <span className="text-right text-[var(--text-primary)] tabular-nums">{hoveredDay.day.turns} 次</span>
            <span>总量</span>
            <span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoveredDay.day.total)}</span>
            <span>输入</span>
            <span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoveredDay.day.input)}</span>
            <span>缓存</span>
            <span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoveredDay.day.cached)}</span>
            <span>输出</span>
            <span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoveredDay.day.output)}</span>
            <span>推理</span>
            <span className="text-right text-[var(--text-primary)] tabular-nums">{formatTokens(hoveredDay.day.reasoning)}</span>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`h-[18px] w-[18px] rounded-[4px] border border-[var(--activity-border)] ${
              level === 0
                ? "bg-[var(--bg-tertiary)]"
                : level === 1
                  ? "bg-[var(--activity-level-1)]"
                  : level === 2
                    ? "bg-[var(--activity-level-2)]"
                    : level === 3
                      ? "bg-[var(--activity-level-3)]"
                      : "bg-[var(--activity-level-4)]"
            }`}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export default function CodexUsagePanel() {
  const [report, setReport] = useState<CodexUsageReport>(EMPTY_REPORT);
  const [mode, setMode] = useState<ViewMode>("day");
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [speedChartMode, setSpeedChartMode] = useState<ChartMode>("line");
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
  const activityUsage = useMemo(
    () => report.usage.filter((item) => selectedProject === "all" || item.project === selectedProject),
    [report.usage, selectedProject],
  );
  const activityDays = useMemo(() => buildActivityDays(selectedDate, activityUsage), [activityUsage, selectedDate]);
  const totals = useMemo(() => sumUsage(filteredUsage), [filteredUsage]);
  const durations = filteredSpeed.map((item) => item.duration);
  const avgDuration = average(durations);
  const sourceSummary = useMemo(() => formatSourceSummary(report.roots), [report.roots]);
  const isInitialChecking = loading && !report.generatedAt;
  const statusText = isInitialChecking
    ? "正在检查 Codex 会话数据源..."
    : report.generatedAt
      ? `更新于 ${new Date(report.generatedAt).toLocaleString("zh-CN")}`
      : "等待刷新";

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
              {statusText}
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
              {loading ? (report.generatedAt ? "刷新中" : "检查中") : "刷新"}
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
            ["总 token", formatTokens(totals.total), "含缓存输入，数值会偏大"],
            ["实际消耗估算", formatTokens(Math.max(totals.total - totals.cached, 0)), "总量扣掉缓存输入"],
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

        <div className="mb-4">
          <ActivityHeatmap days={activityDays} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.9fr] gap-4 mb-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/92 p-4 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-[var(--text-primary)]">{chartMode === "line" ? "用量折线" : "对话散点"}</h2>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {chartMode === "line" ? "按时间段聚合" : "每个点是一条请求事件"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {chartMode === "line" && (
                  <div className="hidden sm:flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-5 rounded-full bg-[var(--accent-cyan)]" />
                      总量
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0 w-5 border-t-2 border-dashed border-[var(--accent-orange)]" />
                      输出
                    </span>
                  </div>
                )}
                <div className="inline-flex rounded-xl border border-[var(--border-color)] overflow-hidden bg-[var(--bg-primary)]">
                  {(["line", "scatter"] as ChartMode[]).map((item) => (
                    <button
                      key={item}
                      onClick={() => setChartMode(item)}
                      className={`h-8 px-3 text-xs cursor-pointer transition-colors ${
                        chartMode === item ? "bg-[var(--accent-cyan)] text-[#0d1117]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {item === "line" ? "折线" : "散点"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {chartMode === "line" ? (
              <UsageChart points={buckets} />
            ) : (
              <ScatterUsageChart items={filteredUsage} mode={mode} selectedDate={selectedDate} />
            )}
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
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-[var(--text-primary)]">{speedChartMode === "line" ? "响应耗时" : "耗时散点"}</h2>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {speedChartMode === "line" ? "按时间段看平均值" : "每个点是一轮可计算请求"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {speedChartMode === "line" && (
                  <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                    <span className="h-2 w-5 rounded-full bg-[var(--accent-blue)]" />
                    平均耗时
                  </span>
                )}
                <div className="inline-flex rounded-xl border border-[var(--border-color)] overflow-hidden bg-[var(--bg-primary)]">
                  {(["line", "scatter"] as ChartMode[]).map((item) => (
                    <button
                      key={item}
                      onClick={() => setSpeedChartMode(item)}
                      className={`h-8 px-3 text-xs cursor-pointer transition-colors ${
                        speedChartMode === item ? "bg-[var(--accent-cyan)] text-[#0d1117]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {item === "line" ? "折线" : "散点"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {speedChartMode === "line" ? (
              <SpeedChart points={buckets} />
            ) : (
              <ScatterSpeedChart items={filteredSpeed} mode={mode} selectedDate={selectedDate} />
            )}
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

        {(loading || report.roots.length > 0) && (
          <div
            className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)]/55 px-3 py-2 flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]"
            title={report.roots.length > 0 ? report.roots.join("\n") : "正在扫描本机 Codex 会话目录"}
          >
            <span className="min-w-0 truncate">
              {loading
                ? "正在检查数据源：主目录会话、归档会话、订阅隔离目录"
                : `数据来源：${sourceSummary}`}
            </span>
            {loading && (
              <span className="h-1.5 w-36 shrink-0 overflow-hidden rounded-full bg-[var(--bg-primary)]">
                <span className="block h-full w-2/3 animate-pulse rounded-full bg-[linear-gradient(90deg,var(--accent-cyan),var(--accent-blue))]" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
