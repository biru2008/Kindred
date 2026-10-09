export const feedbackCategories = [
  { id: "general", label: "General feedback" },
  { id: "good", label: "Good conversation" },
  { id: "not_vibe", label: "Not my vibe" },
  { id: "technical", label: "Connection trouble" },
  { id: "harassment", label: "Harassment" },
  { id: "spam", label: "Spam" },
  { id: "inappropriate", label: "Inappropriate content" },
] as const;
export type FeedbackCategory = (typeof feedbackCategories)[number]["id"];
export type ConnectionDecision = "none" | "accepted" | "declined";
export type RandomConnection = {
  self: ConnectionDecision;
  peer: ConnectionDecision;
  conversation_id: string | null;
};
export function remainingGrace(
  seconds: number | undefined,
  receivedAt: number,
  now: number,
) {
  return Math.max(
    0,
    Math.min(
      seconds || 0,
      Math.ceil((seconds || 0) - (now - receivedAt) / 1000),
    ),
  );
}
