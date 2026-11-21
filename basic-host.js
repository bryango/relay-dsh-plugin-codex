import { on } from "node:events";
import { tmpdir } from "node:os";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { CodexAppServerClient } from "./app-server-client.mjs";

export const name = "relay-dsh-plugin-codex-basic";
export const inject = ["llm", "agents"];
const provider = "relay-codex";
const model = { provider, id: "default", name: "Codex CLI default", inputModalities: ["text"] };
const args = ["app-server", "-c", 'web_search="disabled"', "-c", "mcp_servers={}"];
for (const feature of ["shell_tool", "unified_exec", "code_mode", "hooks", "plugins", "apps"]) args.push("--disable", feature);

function conversation(messages) {
  const items = [];
  for (const { role, content } of messages) {
    if (content.some(block => block.type === "image" || block.type === "file")) throw new Error("Codex Basic accepts text only.");
    if (role !== "user" && role !== "assistant") continue;
    const text = content.filter(block => block.type === "text").map(block => block.text).join("\n");
    if (text) items.push({ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
  }
  const last = items.pop();
  if (last?.role !== "user") throw new Error("Codex Basic requires a user text message.");
  return { history: items, input: [{ type: "text", text: last.content[0].text, text_elements: [] }] };
}

class BasicCodex extends LlmAdapter {
  constructor(signal) { super(); this.signal = signal; }
  providerInfo() { return { id: provider, name: "Codex" }; }
  async listModels() { return [model]; }
  async resolveModel() { return model; }

  async *stream(options) {
    const { history, input } = conversation(options.messages);
    const signal = AbortSignal.any([this.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(300_000)]);
    signal.throwIfAborted();
    const client = new CodexAppServerClient({ args });
    const stop = () => { void client.close(); };
    signal.addEventListener("abort", stop, { once: true });
    client.on("serverRequest", ({ id }) => client.respondError(id, -32601, "Interactive requests are disabled in text-only mode"));
    const events = on(client, "notification", { signal, close: ["exit"] });
    try {
      await client.start();
      const { thread } = await client.request("thread/start", {
        cwd: tmpdir(), ephemeral: true, environments: [], dynamicTools: [], runtimeWorkspaceRoots: [],
        sandbox: "read-only", approvalPolicy: "never", developerInstructions: options.system,
      });
      if (history.length) await client.request("thread/inject_items", { threadId: thread.id, items: history });
      const { turn } = await client.request("turn/start", { threadId: thread.id, input, approvalPolicy: "never", sandboxPolicy: { type: "readOnly" } });
      let text = "";
      for await (const [{ method, params }] of events) {
        if (params?.threadId !== thread.id || (params.turnId && params.turnId !== turn.id)) continue;
        if (method === "item/agentMessage/delta" && params.delta) {
          if (!text) yield { type: "block-start", index: 0, blockType: "text" };
          text += params.delta;
          yield { type: "text-delta", index: 0, text: params.delta };
        }
        if (method === "turn/completed" && params.turn.id === turn.id) {
          if (params.turn.status !== "completed") throw new Error(params.turn.error?.message ?? `Codex turn ${params.turn.status}`);
          if (!text) throw new Error("Codex returned no text.");
          yield { type: "block-end", index: 0, block: { type: "text", text } };
          yield { type: "finish", reason: { kind: "stop" } };
          return;
        }
      }
      throw new Error("Codex App Server closed before the turn completed.");
    } finally {
      signal.removeEventListener("abort", stop);
      await events.return();
      await client.close();
    }
  }
}

export function apply(ctx) {
  const lifetime = new AbortController();
  const adapter = new BasicCodex(lifetime.signal);
  ctx.effect(() => {
    const unregister = ctx.llm.registerAdapter([provider], adapter);
    return () => { lifetime.abort(); unregister(); };
  });
  ctx.on("llm/stream", (options, next) => {
    if (options.purpose || !options.sessionId || options.provider === provider) return next();
    const session = ctx.agents.get(options.sessionId)?.session;
    const preset = session?.snapshotEvents().findLast(e => e.type === "agent-preset/selected")?.data.agentPreset ?? session?.header.agentPreset;
    return preset === provider ? adapter.stream(options) : next();
  }, { global: true, prepend: true });
}
