import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";

/** Only host-created command context is accepted; never expose this as an agent tool. */
export function assertTelegramActor(
  context: Pick<
    PluginCommandContext,
    "channel" | "senderId" | "isAuthorizedSender"
  >,
  allowedUser: string | undefined,
): string {
  if (
    !allowedUser ||
    !/^[1-9]\d*$/.test(allowedUser) ||
    context.channel !== "telegram" ||
    !context.isAuthorizedSender ||
    context.senderId !== allowedUser
  )
    throw new Error("TELEGRAM_APPROVAL_UNAUTHORIZED");
  return allowedUser;
}
