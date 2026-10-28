import type { AgentSession, SourceState } from "./types";

const relative = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });
const dateTime = new Intl.DateTimeFormat("ja", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const clock = new Intl.DateTimeFormat("ja", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "時刻不明";
  return dateTime.format(new Date(timestamp));
}

export function formatClock(timestamp: number): string {
  return clock.format(new Date(timestamp));
}

export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return "unknown";
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  if (absolute < 60) return relative.format(deltaSeconds, "second");
  if (absolute < 3600) return relative.format(Math.round(deltaSeconds / 60), "minute");
  if (absolute < 86400) return relative.format(Math.round(deltaSeconds / 3600), "hour");
  return relative.format(Math.round(deltaSeconds / 86400), "day");
}

export function stateTone<T>(source: SourceState<T>): "ok" | "error" {
  return source.state === "ok" ? "ok" : "error";
}

export function agentAddress(agent: AgentSession): string {
  return agent.address || `${agent.person}/${agent.name}`;
}

export function agentRepo(agent: AgentSession): string {
  if (!agent.repo) return "repo 不明";
  return agent.branch ? `${agent.repo}@${agent.branch}` : agent.repo;
}

export function statusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "busy":
      return "作業中";
    case "idle":
      return "待機";
    case "offline":
      return "オフライン";
    default:
      return status || "不明";
  }
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
