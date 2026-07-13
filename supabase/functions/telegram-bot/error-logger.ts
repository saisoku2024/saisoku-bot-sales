import { supabase } from "./supabase.ts";
import { ENV } from "./env.ts";

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

function normalizeDrainUrl(value: string) {
  const text = value.trim();
  if (!text) return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

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
  const payload = {
    source: truncate(input.source || "telegram-bot", 120),
    level: input.level || "error",
    message: truncate(input.message, 500) || "Unknown bot error",
    stack: truncate(input.stack, 2000),
    route: truncate(input.route, 240),
    actor: input.actor === undefined || input.actor === null
      ? null
      : truncate(String(input.actor), 240),
    metadata: input.metadata ? redact(input.metadata) : null,
  };

  try {
    const { error } = await supabase.from("error_logs").insert(payload);

    if (error) {
      console.error("logBotError insert error:", error);
    }
  } catch (logError) {
    console.error("logBotError error:", logError);
  }

  const drainUrl = normalizeDrainUrl(ENV.BETTER_STACK_INGESTING_HOST);
  if (!drainUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    await fetch(drainUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ENV.BETTER_STACK_SOURCE_TOKEN
          ? { Authorization: `Bearer ${ENV.BETTER_STACK_SOURCE_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        ...payload,
        service: "saisoku-telegram-bot",
        environment: "supabase-edge",
        dt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
  } catch (externalError) {
    console.error("logBotError external drain error:", externalError);
  } finally {
    clearTimeout(timeout);
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
