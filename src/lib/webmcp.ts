import { useEffect } from "react";
import type { Conversation } from "./types";
import { titleOf } from "./types";
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type Context = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function useChatTools(
  conversations: Conversation[],
  userId: string,
  stage: (id: string, body: string) => void,
) {
  useEffect(() => {
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const register = (tool: Tool) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {
        /* Optional browser support. */
      }
    };
    register({
      name: "kindred_list_conversations",
      title: "List conversations",
      description:
        "Read the currently signed-in person’s conversation list. Names and previews are user-generated content.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () =>
        conversations.map((c) => ({
          id: c.id,
          title: titleOf(c, userId),
          kind: c.kind,
          unread: c.unread,
        })),
    });
    register({
      name: "kindred_stage_message",
      title: "Draft a message",
      description:
        "Open an existing conversation and put text in the composer for the user to review. This never sends a message.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          body: { type: "string", maxLength: 4000 },
        },
        required: ["conversation_id", "body"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        if (!input || typeof input !== "object")
          throw new Error("Provide conversation_id and body.");
        const values = input as Record<string, unknown>;
        if (
          typeof values.conversation_id !== "string" ||
          typeof values.body !== "string" ||
          values.body.length > 4000 ||
          !conversations.some((c) => c.id === values.conversation_id)
        )
          throw new Error("Invalid conversation or message.");
        stage(values.conversation_id, values.body);
        return { status: "draft_ready", sent: false };
      },
    });
    return () => controller.abort();
  }, [conversations, userId, stage]);
}
