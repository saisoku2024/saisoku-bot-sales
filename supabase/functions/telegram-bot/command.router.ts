import type { BotContext } from "./context.ts";

type CommandHandlers = {
  handleClaimVoucherCommand: (ctx: BotContext) => Promise<Response>;
  handleManagedAdminCommand: (ctx: BotContext) => Promise<Response>;
  handleStartCommand: (ctx: BotContext) => Promise<Response>;
};

export async function routeCommand(
  ctx: BotContext,
  handlers: CommandHandlers
): Promise<Response | null> {
  const { cmd } = ctx;

  if (!cmd) return null;

  if (cmd === "/start") {
    return await handlers.handleStartCommand(ctx);
  }

  if (cmd === "/claimvoucher") {
    return await handlers.handleClaimVoucherCommand(ctx);
  }

  const managedAdminCommands = new Set([
    "/setrole",
    "/addvoucher",
    "/delvoucher",
    "/nonaktifvoucher",
    "/aktifvoucher",
    "/broadcast",
    "/ban",
    "/unban",
    "/voucherlist",
    "/addsaldo",
    "/addbalance",
    "/remsaldo",
  ]);

  if (managedAdminCommands.has(cmd)) {
    return await handlers.handleManagedAdminCommand(ctx);
  }

  return null;
}