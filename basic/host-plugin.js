// basic-host.js
import { on } from "node:events";
import { homedir as homedir2, tmpdir } from "node:os";
import { delimiter as delimiter2, isAbsolute as isAbsolute2, join as join2 } from "node:path";

// codex-command.mjs
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
var require2 = createRequire(import.meta.url);
var BUNDLED_CODEX_ENTRY = "@openai/codex/bin/codex.js";
var PLATFORM_PACKAGE = Object.freeze({
  "darwin-arm64": "@openai/codex-darwin-arm64",
  "darwin-x64": "@openai/codex-darwin-x64",
  "linux-arm64": "@openai/codex-linux-arm64",
  "linux-x64": "@openai/codex-linux-x64",
  "win32-arm64": "@openai/codex-win32-arm64",
  "win32-x64": "@openai/codex-win32-x64"
});
function resolveCodexLaunch({
  command,
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  arch = process.arch,
  homeDirectory = homedir(),
  candidatePaths,
  fsApi = { accessSync, realpathSync, statSync },
  resolvePackage = require2.resolve
} = {}) {
  const configured = nonBlank(command);
  if (configured !== void 0) return resolveRequested(configured, "config");
  const environmentCommand = nonBlank(env.RELAY_CODEX_COMMAND);
  if (environmentCommand !== void 0) {
    return resolveRequested(environmentCommand, "environment");
  }
  return resolveAuto({
    env,
    execPath,
    platform,
    arch,
    homeDirectory,
    candidatePaths,
    fsApi,
    resolvePackage
  });
  function resolveRequested(value, origin) {
    if (value.toLowerCase() === "auto") {
      return resolveAuto({
        env,
        execPath,
        platform,
        arch,
        homeDirectory,
        candidatePaths,
        fsApi,
        resolvePackage
      });
    }
    if (value.toLowerCase() === "bundled") {
      return bundledLaunch({ platform, arch, execPath, resolvePackage });
    }
    return Object.freeze({
      command: validateExecutablePath(value, { platform, fsApi }),
      argsPrefix: [],
      source: origin,
      mode: "explicit"
    });
  }
}
function resolveAuto({
  env,
  execPath,
  platform,
  arch,
  homeDirectory,
  candidatePaths,
  fsApi,
  resolvePackage
}) {
  const failures = [];
  for (const candidate of candidatePaths ?? defaultCandidatePaths({
    env,
    platform,
    homeDirectory
  })) {
    const path = nonBlank(candidate);
    if (path === void 0) continue;
    try {
      const command = validateExecutablePath(path, { platform, fsApi });
      return Object.freeze({
        command,
        argsPrefix: [],
        source: "local",
        mode: "auto",
        fallback: bundledLaunch({ platform, arch, execPath, resolvePackage })
      });
    } catch (error) {
      failures.push({ path, code: error.code ?? "CODEX_EXECUTABLE_INVALID" });
    }
  }
  const launch = bundledLaunch({ platform, arch, execPath, resolvePackage });
  return Object.freeze({
    ...launch,
    mode: "auto",
    discoveryFailures: failures
  });
}
function defaultCandidatePaths({ env, platform, homeDirectory }) {
  const candidates = [];
  if (platform === "darwin") {
    for (const base of ["/Applications", join(homeDirectory, "Applications")]) {
      candidates.push(
        join(base, "ChatGPT.app", "Contents", "Resources", "codex"),
        join(base, "Codex.app", "Contents", "Resources", "codex")
      );
    }
  } else if (platform === "win32") {
    const bases = [
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs"),
      env.PROGRAMFILES,
      env["PROGRAMFILES(X86)"]
    ].filter(Boolean);
    for (const base of bases) {
      candidates.push(
        join(base, "ChatGPT", "resources", "codex.exe"),
        join(base, "Codex", "resources", "codex.exe")
      );
    }
  } else if (platform === "linux") {
    for (const base of [
      env.XDG_DATA_HOME && join(env.XDG_DATA_HOME, "applications"),
      join(homeDirectory, ".local", "share", "applications")
    ].filter(Boolean)) {
      candidates.push(
        join(base, "ChatGPT", "resources", "codex"),
        join(base, "Codex", "resources", "codex")
      );
    }
  }
  const pathSeparator = platform === "win32" ? ";" : delimiter;
  const pathEntries = typeof env.PATH === "string" ? env.PATH.split(pathSeparator) : [];
  for (const entry of pathEntries) {
    if (!nonBlank(entry)) continue;
    candidates.push(join(entry, platform === "win32" ? "codex.exe" : "codex"));
  }
  return candidates;
}
function bundledLaunch({ platform, arch, execPath, resolvePackage }) {
  const platformPackage = PLATFORM_PACKAGE[`${platform}-${arch}`];
  if (platformPackage === void 0) {
    const error = new Error(
      `The bundled Codex runtime does not support ${platform}/${arch}. Set RELAY_CODEX_COMMAND to a compatible Codex executable.`
    );
    error.code = "CODEX_PLATFORM_UNSUPPORTED";
    throw error;
  }
  let launcher;
  try {
    launcher = resolvePackage(BUNDLED_CODEX_ENTRY);
    resolvePackage(`${platformPackage}/package.json`);
  } catch (cause) {
    const error = new Error(
      `The bundled Codex runtime for ${platform}/${arch} is unavailable. Reinstall relay-dsh-plugin-codex, or set RELAY_CODEX_COMMAND to an absolute Codex executable path.`,
      { cause }
    );
    error.code = "CODEX_RUNTIME_MISSING";
    throw error;
  }
  return Object.freeze({
    command: execPath,
    argsPrefix: [launcher],
    source: "bundled",
    mode: "bundled"
  });
}
function validateExecutablePath(value, { platform = process.platform, fsApi = { accessSync, realpathSync, statSync } } = {}) {
  const path = nonBlank(value);
  if (path === void 0 || !isAbsoluteForPlatform(path, platform)) {
    throw executableInvalidError(value, "an absolute executable path is required");
  }
  const { accessSync: checkAccess, realpathSync: resolvePath, statSync: stat } = fsApi;
  let canonical;
  try {
    canonical = resolvePath(path);
  } catch (cause) {
    const error = executableNotFoundError(path);
    error.cause = cause;
    throw error;
  }
  try {
    const details = stat(canonical);
    if (!details.isFile()) throw executableInvalidError(path, "the path is not a regular file");
    checkAccess(canonical, constants.X_OK);
  } catch (cause) {
    if (cause?.code === "CODEX_EXECUTABLE_INVALID") throw cause;
    throw executableInvalidError(path, "the file is not executable", cause);
  }
  return canonical;
}
function codexSpawnError(error, command, source) {
  if (error?.code !== "ENOENT") return error;
  const wrapped = executableNotFoundError(command);
  wrapped.message = `Unable to start Codex from ${JSON.stringify(command)} (${source}). Set RELAY_CODEX_COMMAND to an absolute Codex executable path, or reinstall relay-dsh-plugin-codex to restore its bundled runtime.`;
  wrapped.cause = error;
  return wrapped;
}
function executableNotFoundError(path) {
  const error = new Error(
    `Codex executable was not found at ${JSON.stringify(path)}. Set RELAY_CODEX_COMMAND to an absolute executable path, or use auto/bundled.`
  );
  error.code = "CODEX_EXECUTABLE_NOT_FOUND";
  error.path = path;
  return error;
}
function executableInvalidError(path, reason, cause) {
  const error = new Error(`Codex executable at ${JSON.stringify(path)} is invalid: ${reason}.`);
  error.code = "CODEX_EXECUTABLE_INVALID";
  error.path = path;
  if (cause !== void 0) error.cause = cause;
  return error;
}
function isAbsoluteForPlatform(value, platform) {
  return platform === "win32" ? /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) : isAbsolute(value);
}
function nonBlank(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}

// basic-host.js
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

// app-server-client.mjs
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
var NATIVE_CODEX_CLIENT_INFO = {
  name: "relay_codex",
  title: "DSH Codex",
  version: "0.1.6-rc.1"
};
var RELAY_CODEX_APP_SERVER_ARGS = [
  "-c",
  "features.code_mode_host=true",
  "-c",
  "features.shell_snapshot=false",
  "app-server",
  "--analytics-default-enabled"
];
var BYPASS_HOOK_TRUST_FLAG = "--dangerously-bypass-hook-trust";
var NATIVE_CODEX_CAPABILITIES = {
  experimentalApi: true,
  mcpServerOpenaiFormElicitation: false,
  // This host has no Desktop attestation provider or MCP App HTML renderer.
  requestAttestation: false,
  optOutNotificationMethods: [
    "thread/environment/connected",
    "thread/environment/disconnected",
    "externalAgentConfig/import/progress",
    "thread/compacted",
    "windows/worldWritableWarning",
    "turn/moderationMetadata",
    "authStatusChange",
    "loginChatGptComplete",
    "codex/event/task_started",
    "codex/event/agent_reasoning",
    "codex/event/agent_message",
    "codex/event/task_complete",
    "codex/event/mcp_tool_call_begin",
    "codex/event/mcp_tool_call_end",
    "codex/event/exec_command_begin",
    "codex/event/exec_command_end",
    "codex/event/exec_command_output_delta",
    "codex/event/exec_approval_request",
    "codex/event/apply_patch_approval_request",
    "codex/event/background_event",
    "codex/event/turn_diff",
    "codex/event/get_history_entry_response",
    "codex/event/agent_reasoning_delta",
    "codex/event/agent_reasoning_section_break",
    "codex/event/agent_message_delta",
    "codex/event/stream_error",
    "codex/event/error",
    "codex/event/turn_aborted",
    "codex/event/plan_delta",
    "codex/event/plan_update",
    "codex/event/patch_apply_begin",
    "codex/event/patch_apply_end",
    "codex/event/item_started",
    "codex/event/item_completed",
    "codex/event/user_message",
    "codex/event/agent_reasoning_raw_content",
    "codex/event/agent_reasoning_raw_content_delta",
    "codex/event/web_search_begin",
    "codex/event/web_search_end",
    "codex/event/mcp_list_tools_response",
    "codex/event/list_skills_response",
    "codex/event/list_remote_skills_response",
    "codex/event/remote_skill_downloaded",
    "codex/event/list_custom_prompts_response",
    "codex/event/raw_response_item",
    "codex/event/agent_message_content_delta",
    "codex/event/reasoning_content_delta",
    "codex/event/reasoning_raw_content_delta",
    "codex/event/warning",
    "codex/event/undo_started",
    "codex/event/undo_completed",
    "codex/event/shutdown_complete",
    "codex/event/entered_review_mode",
    "codex/event/exited_review_mode",
    "codex/event/view_image_tool_call",
    "codex/event/mcp_startup_update",
    "codex/event/mcp_startup_complete",
    "codex/event/remote_task_created",
    "codex/event/thread_rolled_back",
    "codex/event/thread_name_updated",
    "codex/event/elicitation_request",
    "codex/event/dynamic_tool_call_request",
    "codex/event/request_user_input",
    "codex/event/terminal_interaction",
    "codex/event/token_count",
    "codex/event/deprecation_notice",
    "thread/closed",
    "rawResponse/completed",
    "warning"
  ]
};
var CodexAppServerClient = class extends EventEmitter {
  constructor({
    command,
    args: args2 = RELAY_CODEX_APP_SERVER_ARGS,
    requestTimeoutMs = 3e4,
    clientInfo = NATIVE_CODEX_CLIENT_INFO,
    capabilities = NATIVE_CODEX_CAPABILITIES,
    launchOptions = {}
  } = {}) {
    super();
    this.launch = resolveCodexLaunch({ command, ...launchOptions });
    this.command = this.launch.command;
    this.commandSource = this.launch.source;
    this.launchMode = this.launch.mode;
    this.appServerArgs = [...args2];
    this.bypassHookTrust = args2.includes(BYPASS_HOOK_TRUST_FLAG);
    this.args = [...this.launch.argsPrefix, ...args2];
    this.requestTimeoutMs = requestTimeoutMs;
    this.clientInfo = structuredClone(clientInfo);
    this.capabilities = structuredClone(capabilities);
    this.process = null;
    this.initialModels = null;
    this.nextRequestId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.closed = false;
  }
  async start() {
    if (this.process) return;
    try {
      await this.startLaunch(this.launch);
    } catch (error) {
      if (this.closed || !this.launch.fallback) throw error;
      this.emit(
        "diagnostic",
        `Automatic Codex runtime at ${this.launch.command} failed preflight: ${error?.code ?? "ERROR"} ${error?.message ?? error}; falling back to bundled runtime.`
      );
      await this.stopProcess();
      this.launch = this.launch.fallback;
      this.applyLaunch(this.launch);
      try {
        await this.startLaunch(this.launch);
      } catch (fallbackError) {
        fallbackError.cause ??= error;
        throw fallbackError;
      }
    }
  }
  async startLaunch(launch) {
    this.closed = false;
    this.applyLaunch(launch);
    this.initialModels = null;
    const child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32" && /\.(?:bat|cmd)$/i.test(this.command)
    });
    this.process = child;
    const output = readline.createInterface({ input: child.stdout });
    output.on("line", (line) => this.handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.emit("diagnostic", String(chunk)));
    child.stdin.on("error", (error) => this.handleStdinError(error));
    child.once("error", (error) => {
      if (this.process !== child) return;
      this.process = null;
      this.failAll(codexSpawnError(error, this.command, this.commandSource));
    });
    child.once("exit", (code, signal) => {
      if (this.process !== child) return;
      this.process = null;
      if (!this.closed) {
        this.failAll(new Error(`codex app-server exited (${signal ?? code})`));
      }
      this.emit("exit", { code, signal });
    });
    try {
      await this.request("initialize", {
        clientInfo: this.clientInfo,
        capabilities: this.capabilities
      });
      this.notify("initialized", {});
      const models = await this.request("model/list", { limit: 50, includeHidden: false });
      assertUsableModelList(models);
      this.initialModels = structuredClone(models);
    } catch (error) {
      await this.stopProcess();
      throw error;
    }
  }
  applyLaunch(launch) {
    this.command = launch.command;
    this.commandSource = launch.source;
    this.launchMode = launch.mode;
    this.args = [...launch.argsPrefix, ...this.appServerArgs];
  }
  get runtimeInfo() {
    return {
      source: this.commandSource,
      path: this.launch.argsPrefix[0] ?? this.command,
      modelCount: Array.isArray(this.initialModels?.data) ? this.initialModels.data.length : 0
    };
  }
  request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(appServerNotRunningError());
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs === null ? null : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.write({ method, id, params });
    });
  }
  notify(method, params = {}) {
    this.write({ method, params });
  }
  respond(id, result) {
    this.write({ id, result });
  }
  respondError(id, code, message) {
    this.write({ id, error: { code, message } });
  }
  async close() {
    this.closed = true;
    this.failAll(new Error("codex app-server client closed"));
    await this.stopProcess();
  }
  async stopProcess() {
    if (!this.process) return;
    const child = this.process;
    this.process = null;
    this.failAll(new Error("codex app-server process stopped"));
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1e3);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("diagnostic", `invalid app-server JSON: ${error.message}
${line}`);
      return;
    }
    if (message.id != null && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) {
          const error = new Error(message.error.message ?? `${pending.method} failed`);
          error.code = message.error.code;
          error.data = message.error.data;
          pending.reject(error);
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }
    if (message.id != null && message.method) {
      this.emit("serverRequest", message);
      return;
    }
    if (message.method) {
      this.emit("notification", message);
    }
  }
  write(message) {
    if (!this.process?.stdin?.writable) {
      throw appServerNotRunningError();
    }
    this.process.stdin.write(`${JSON.stringify(message)}
`);
  }
  handleStdinError(error) {
    this.emit("diagnostic", `codex app-server stdin failed: ${error.message}`);
    this.failAll(error);
  }
  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
};
function appServerNotRunningError() {
  const error = new Error("Codex App Server is not running. Restart DSH and inspect the Codex status in Settings.");
  error.code = "CODEX_APP_SERVER_NOT_RUNNING";
  return error;
}
function assertUsableModelList(result) {
  if (!Array.isArray(result?.data)) {
    const error = new Error("Codex App Server returned an invalid model/list response.");
    error.code = "CODEX_MODEL_LIST_INVALID";
    throw error;
  }
  if (!result.data.some((model2) => typeof model2?.id === "string" && model2.id.trim())) {
    const error = new Error("Codex App Server returned no usable models.");
    error.code = "CODEX_MODEL_LIST_EMPTY";
    throw error;
  }
}

// basic-host.js
function systemCodex() {
  const override = process.env.RELAY_CODEX_COMMAND?.trim();
  if (override && override !== "auto") {
    try {
      return validateExecutablePath(override);
    } catch {
      throw new Error("Codex executable override is invalid.");
    }
  }
  const dirs = [...(process.env.PATH ?? "").split(delimiter2), join2(homedir2(), "bin"), join2(homedir2(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const dir of dirs.filter(isAbsolute2)) {
    try {
      return validateExecutablePath(join2(dir, process.platform === "win32" ? "codex.exe" : "codex"));
    } catch {
    }
  }
  throw new Error("System Codex not found; set RELAY_CODEX_COMMAND to an absolute executable path.");
}
var name = "relay-dsh-plugin-codex-basic";
var inject = ["llm", "agents"];
var provider = "relay-codex";
var model = { provider, id: "default", name: "Codex CLI default", inputModalities: ["text"] };
var args = ["app-server", "-c", 'web_search="disabled"', "-c", "mcp_servers={}"];
for (const feature of ["shell_tool", "unified_exec", "code_mode", "hooks", "plugins", "apps"]) args.push("--disable", feature);
function conversation(messages) {
  const items = [];
  for (const { role, content } of messages) {
    if (content.some((block) => block.type === "image" || block.type === "file")) throw new Error("Codex Basic accepts text only.");
    if (role !== "user" && role !== "assistant") continue;
    const text = content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    if (text) items.push({ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
  }
  const last = items.pop();
  if (last?.role !== "user") throw new Error("Codex Basic requires a user text message.");
  return { history: items, input: [{ type: "text", text: last.content[0].text, text_elements: [] }] };
}
var BasicCodex = class extends LlmAdapter {
  constructor(signal) {
    super();
    this.signal = signal;
  }
  providerInfo() {
    return { id: provider, name: "Codex" };
  }
  async listModels() {
    return [model];
  }
  async resolveModel() {
    return model;
  }
  async *stream(options) {
    const { history, input } = conversation(options.messages);
    const signal = AbortSignal.any([this.signal, ...options.signal ? [options.signal] : [], AbortSignal.timeout(3e5)]);
    signal.throwIfAborted();
    const client = new CodexAppServerClient({ args, command: systemCodex() });
    const stop = () => {
      void client.close();
    };
    signal.addEventListener("abort", stop, { once: true });
    client.on("serverRequest", ({ id }) => client.respondError(id, -32601, "Interactive requests are disabled in text-only mode"));
    const events = on(client, "notification", { signal, close: ["exit"] });
    try {
      await client.start();
      const { thread } = await client.request("thread/start", {
        cwd: tmpdir(),
        ephemeral: true,
        environments: [],
        dynamicTools: [],
        runtimeWorkspaceRoots: [],
        sandbox: "read-only",
        approvalPolicy: "never",
        developerInstructions: options.system
      });
      if (history.length) await client.request("thread/inject_items", { threadId: thread.id, items: history });
      const { turn } = await client.request("turn/start", { threadId: thread.id, input, approvalPolicy: "never", sandboxPolicy: { type: "readOnly" } });
      let text = "";
      for await (const [{ method, params }] of events) {
        if (params?.threadId !== thread.id || params.turnId && params.turnId !== turn.id) continue;
        if (method === "item/agentMessage/delta" && params.delta) {
          if (!text) yield { type: "block-start", index: 0, blockType: "text" };
          text += params.delta;
          yield { type: "text-delta", index: 0, text: params.delta };
        }
        if (method === "turn/completed" && params.turn.id === turn.id) {
          if (params.turn.status !== "completed") throw new Error("Codex turn did not complete.");
          if (!text) throw new Error("Codex returned no text.");
          yield { type: "block-end", index: 0, block: { type: "text", text } };
          yield { type: "finish", reason: { kind: "stop" } };
          return;
        }
      }
      throw new Error("Codex App Server closed before the turn completed.");
    } catch (error) {
      if (signal.aborted) throw new Error("Codex request cancelled or timed out.");
      const message = String(error?.message ?? "");
      const category = /unauthori[sz]ed|authentication|not logged in|401/i.test(message) ? "authentication" : /quota|rate.limit|429/i.test(message) ? "quota or rate limit" : /permission|denied|EACCES|EPERM/i.test(message) ? "permission denied" : /timeout|timed out/i.test(message) ? "timeout" : /exited|closed|stopped/i.test(message) ? "server exited" : "request failed";
      throw new Error(`Codex App Server: ${category}.`);
    } finally {
      signal.removeEventListener("abort", stop);
      await events.return();
      await client.close();
    }
  }
};
function apply(ctx) {
  const lifetime = new AbortController();
  const adapter = new BasicCodex(lifetime.signal);
  ctx.effect(() => {
    const unregister = ctx.llm.registerAdapter([provider], adapter);
    return () => {
      lifetime.abort();
      unregister();
    };
  });
  ctx.on("llm/stream", (options, next) => {
    if (options.purpose || !options.sessionId || options.provider === provider) return next();
    const session = ctx.agents.get(options.sessionId)?.session;
    const preset = session?.snapshotEvents().findLast((e) => e.type === "agent-preset/selected")?.data.agentPreset ?? session?.header.agentPreset;
    return preset === provider ? adapter.stream(options) : next();
  }, { global: true, prepend: true });
}
export {
  apply,
  inject,
  name
};
