export const DAY_NAMES = [
"Sunday",
"Monday",
"Tuesday",
"Wednesday",
"Thursday",
"Friday",
"Saturday",
] as const;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DANISH_MONTHS = [
"jan",
"feb",
"mar",
"apr",
"maj",
"jun",
"jul",
"aug",
"sep",
"okt",
"nov",
"dec",
];

export function formatDuration(seconds: number): string {
if (seconds <= 0) {
return "—";
}
const minutes = Math.floor(seconds / 60);
const rest = seconds % 60;
return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

export function formatRelative(input: Date | string): string {
const date = typeof input === "string" ? new Date(input) : input;
const diffMs = Date.now() - date.getTime();
const minutes = Math.round(diffMs / 60000);
if (minutes < 1) return "just now";
if (minutes < 60) return `${minutes}m ago`;
const hours = Math.round(minutes / 60);
if (hours < 24) return `${hours}h ago`;
const days = Math.round(hours / 24);
if (days < 7) return `${days}d ago`;
return `${date.getDate()} ${DANISH_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateTime(input: Date | string): string {
const date = typeof input === "string" ? new Date(input) : input;
return `${date.getDate()} ${DANISH_MONTHS[date.getMonth()]} · ${String(date.getHours()).padStart(2, "0")}:${String(
date.getMinutes(),
).padStart(2, "0")}`;
}

export function formatClock(seconds: number): string {
const minutes = Math.floor(seconds / 60);
const rest = seconds % 60;
return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function titleCase(value: string): string {
return value
.split(/[\s_-]+/)
.filter(Boolean)
.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
.join(" ");
}

export function truncate(value: string, limit: number): string {
if (value.length <= limit) return value;
return `${value.slice(0, limit - 1).trimEnd()}…`;
}

export function initials(name: string): string {
return name
.split(" ")
.filter(Boolean)
.slice(0, 2)
.map((part) => part.charAt(0).toUpperCase())
.join("");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatMs(ms: number): string {
  if (ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
