import z from "@deepseek-ai/schemastery";
import { PluginHost } from "./internal/plugin-sdk.mjs";
import { CodexRuntimeController, createCodexExecutionPlugin } from "./plugin.mjs";
import { createDshCodexPlugin } from "./dsh-plugin.js";
export const name = "relay-dsh-plugin-codex";
export const inject = [
  "agents", "approval", "attachments", "llm", "sessions", "sessionPersistence", "tools",
  "userQuestions", "webServer", "workspaceRegistry", "sessionTitle",
];

export const CODEX_SETTINGS_NAMESPACE = "relay-codex";
export const CODEX_SETTINGS_SCHEMA = z.object({
  codexCommand: z.string().default(""),
});

export const Config = CODEX_SETTINGS_SCHEMA;

export async function apply(ctx, config = {}) {
  const host = new PluginHost();
  const controller = new CodexRuntimeController({ ...config, ...(config.codex ?? {}) });
  const release = ctx.effect(() => () => host.dispose(), "relay.codex()");
  try {
    await host.activate([
      createCodexExecutionPlugin({
        ...config.codex, command: nonBlank(config.codexCommand), controller, args: config.codexArgs,
        requestTimeoutMs: config.codexRequestTimeoutMs, cwd: config.cwd,
        onReload: () => ctx.emit?.("llm/adapters-updated"),
      }),
      createDshCodexPlugin(ctx, config),
    ]);
  } catch (error) {
    await release();
    throw error;
  }
}

function nonBlank(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
