import "server-only";

import type { Workspace } from "@/db/schema";
import { getAgencyWorkspace, getWorkspaceBySlug } from "@/lib/data";

export function isRecord(value: unknown): value is Record<string, unknown> {
return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
try {
const parsed: unknown = await request.json();
return isRecord(parsed) ? parsed : {};
} catch {
return {};
}
}

export function readString(body: Record<string, unknown>, key: string, fallback = ""): string {
const value = body[key];
return typeof value === "string" ? value : fallback;
}

export function readNumber(body: Record<string, unknown>, key: string, fallback = 0): number {
const value = body[key];
return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readBoolean(body: Record<string, unknown>, key: string, fallback = false): boolean {
const value = body[key];
return typeof value === "boolean" ? value : fallback;
}

export function jsonError(message: string, status = 400): Response {
return Response.json({ error: message }, { status });
}

export async function resolveRequestWorkspace(
body: Record<string, unknown>,
): Promise<Workspace | null> {
const slug = readString(body, "workspaceSlug").trim();
if (slug) {
return getWorkspaceBySlug(slug);
}
return getAgencyWorkspace();
}

export function isValidHttpUrl(value: string): boolean {
try {
const url = new URL(value);
return url.protocol === "http:" || url.protocol === "https:";
} catch {
return false;
}
}

export function isLanguage(value: string): value is "da" | "en" {
return value === "da" || value === "en";
}

export function trimTo(value: string, max: number): string {
return value.trim().slice(0, max);
}
