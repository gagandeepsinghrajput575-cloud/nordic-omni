import { getHours, getKnowledge, getPortalWorkspace, getWorkspaceBySlug } from "@/lib/data";
import { describeProviderError, streamReceptionistReply, type ReceptionistEvent } from "@/lib/ai/service";
import { isLanguage, isRecord, jsonError, readJson, readString } from "@/lib/api-utils";
import type { ChatTurn, Channel, Language } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ChatTurn[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const role = entry.role;
    const content = entry.content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      turns.push({ role, content: content.slice(0, 2000) });
    }
  }
  return turns.slice(-14);
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const slug = readString(body, "workspaceSlug").trim();
  const workspace = slug ? await getWorkspaceBySlug(slug) : await getPortalWorkspace();
  if (!workspace) {
    return jsonError("Unknown workspace for this showcase", 404);
  }

  const history = parseHistory(body.messages);
  if (history.length === 0) {
    return jsonError("At least one conversation turn is required");
  }

  const languageValue = readString(body, "language", workspace.defaultLanguage);
  const language: Language = isLanguage(languageValue) ? languageValue : "da";
  const channelValue = readString(body, "channel", "browser");
  const channel: Channel = channelValue === "phone" ? "phone" : "browser";

  const [knowledge, hours] = await Promise.all([getKnowledge(workspace.id), getHours(workspace.id)]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ReceptionistEvent): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        for await (const event of streamReceptionistReply({
          workspace,
          knowledge,
          hours,
          language,
          history,
          callerName: readString(body, "callerName").slice(0, 120) || undefined,
          callerPhone: readString(body, "callerPhone").slice(0, 40) || undefined,
          channel,
        })) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: describeProviderError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}