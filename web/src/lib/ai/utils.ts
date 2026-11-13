export function maskingSafe(value: string): string {
return value.trim().length > 0 ? value.trim() : "Custom provider";
}

export function clamp(value: number, min: number, max: number): number {
return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number): Promise<void> {
return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readNdjson(
response: Response,
onEvent: (event: unknown) => void,
): Promise<void> {
if (!response.body) return;
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
const { done, value } = await reader.read();
if (done) break;
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
buffer = lines.pop() ?? "";
for (const line of lines) {
const trimmed = line.trim();
if (!trimmed) continue;
try {
onEvent(JSON.parse(trimmed) as unknown);
} catch {
// Ignore malformed keep-alive fragments.
}
}
}
const tail = buffer.trim();
if (tail) {
try {
onEvent(JSON.parse(tail) as unknown);
} catch {
// Ignore.
}
}
}
