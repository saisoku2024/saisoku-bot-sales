import { supabase } from "./supabase.ts";

type BotErrorLogInput = {
  source?: string;
  level?: "error" | "warn" | "info";
  message: string;
  stack?: string | null;
  route?: string | null;
  actor?: string | number | null;
  metadata?: Record<string, unknown> | null;
};

const sensitiveKeyPattern = /(password|token|secret|key|authorization|credential|pin)/i;

function truncate(value: string | null | undefined, maxLength: number) {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" : redact(item),
    ]),
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown bot error";
  }
}

function errorStack(error: unknown) {
  return error instanceof Error ? error.stack || null : null;
}

export function getBotErrorMessage(error: unknown) {
  return errorMessage(error);
}

export async function logBotError(input: BotErrorLogInput) {
  try {
    const { error } = await supabase.from("error_logs").insert({
      source: truncate(input.source || "telegram-bot", 120),
      level: input.level || "error",
      message: truncate(input.message, 500) || "Unknown bot error",
      stack: truncate(input.stack, 2000),
      route: truncate(input.route, 240),
      actor: input.actor === undefined || input.actor === null
        ? null
        : truncate(String(input.actor), 240),
      metadata: input.metadata ? redact(input.metadata) : null,
    });

    if (error) {
      console.error("logBotError insert error:", error);
    }
  } catch (logError) {
    console.error("logBotError error:", logError);
  }
}

export async function logCaughtBotError(
  error: unknown,
  input: Omit<BotErrorLogInput, "message" | "stack"> & { message?: string } = {},
) {
  await logBotError({
    ...input,
    message: input.message || errorMessage(error),
    stack: errorStack(error),
  });
}
