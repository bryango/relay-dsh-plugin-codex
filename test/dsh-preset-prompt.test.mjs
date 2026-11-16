import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { CodexDshAdapter } from "../codex-adapter.js";

test("Creator mode's system prompt reaches its shared Codex thread", async () => {
  const runtime = new PromptRuntime();
  const adapter = new CodexDshAdapter({ runtime, ready: Promise.resolve() });
  const agent = {
    id: "creator-session",
    session: {
      header: { agentPreset: "cordis", cwd: "/tmp/creator-test" },
      events: [],
      append() {},
    },
  };
  adapter.attachAgent(agent);

  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: "relay-codex", model: "codex-test", sessionId: agent.id,
    messages: [
      { role: "system", source: { kind: "system-prompt" }, content: [{ type: "text", text: "You help the user customize DeepSeek Harness itself." }] },
      { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "Create a DSH plugin" }] },
    ],
  })) chunks.push(chunk);

  assert.match(runtime.createdConfig.developerInstructions, /You help the user customize DeepSeek Harness itself/);
  assert.match(runtime.createdConfig.developerInstructions, /Keep tool discovery narrow/);
  assert.equal(runtime.sent.text, "Create a DSH plugin");
  assert.equal(chunks.at(-1).reason.kind, "stop");
});

class PromptRuntime extends EventEmitter {
  constructor() {
    super();
    this.models = [{ id: "codex-test", isDefault: true }];
    this.sessions = new Map();
  }

  async createSession(config) {
    this.createdConfig = config;
    const session = { id: "shared-thread", ...config };
    this.sessions.set(session.id, session);
    return session;
  }

  async sendMessage(threadId, message) {
    this.sent = message;
    queueMicrotask(() => this.emit("activity", {
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: "creator-turn", status: "completed",
          items: [{ type: "agentMessage", id: "answer", text: "done", phase: "final_answer" }],
        },
      },
    }));
    return { id: "creator-turn" };
  }
}
