import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  type ExtensionUIContext,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { ApprovalRequestId, ProviderInstanceId, ThreadId } from "@waypoint/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import { layerTest, ServerConfig } from "../../config.ts";
import { makePiAdapter } from "./PiAdapter.ts";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  createAgentSession: vi.fn(),
}));

const testLayer = layerTest(process.cwd(), { prefix: "waypoint-pi-adapter-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
const threadId = ThreadId.make("pi-test-thread");

type Message = AgentSession["messages"][number];
const assistantMessage = (
  stopReason: "stop" | "toolUse",
  input: number,
  output: number,
): Message => ({
  role: "assistant",
  content: [{ type: "text", text: "Test response" }],
  api: "anthropic-messages",
  provider: "test-provider",
  model: "test-model",
  timestamp: 0,
  stopReason,
  usage: {
    input,
    output,
    cacheRead: 3,
    cacheWrite: 2,
    totalTokens: input + output + 5,
    cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0, total: 0.2 },
  },
});

const makeFixture = Effect.fn("PiAdapter.test.makeFixture")(function* () {
  const config = yield* ServerConfig;
  const messages: Message[] = [];
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  let extensionUI: ExtensionUIContext | undefined;
  let activeTools = ["read", "bash", "edit", "write", "custom_tool"];
  const agent = {
    messages,
    isStreaming: false,
    isIdle: true,
    sessionId: "test-session",
    sessionFile: `${config.stateDir}/pi-sessions/test.jsonl`,
    model: undefined,
    resourceLoader: {
      getSkills: () => ({
        skills: [{ name: "review" }],
        diagnostics: [],
      }),
    },
    subscribe: (next: (event: AgentSessionEvent) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    getActiveToolNames: () => [...activeTools],
    setActiveToolsByName: (names: string[]) => {
      activeTools = names;
    },
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    setModel: vi.fn(),
    bindExtensions: vi.fn(async (bindings: { uiContext?: ExtensionUIContext }) => {
      extensionUI = bindings.uiContext;
    }),
    dispose: vi.fn(),
    abort: vi.fn(async () => {
      agent.isStreaming = false;
      agent.isIdle = true;
    }),
    prompt: vi.fn(async () => {}),
  };
  vi.mocked(createAgentSession).mockResolvedValue({
    session: agent as unknown as AgentSession,
    extensionsResult: {} as Awaited<ReturnType<typeof createAgentSession>>["extensionsResult"],
  });
  const adapter = yield* makePiAdapter({ getModel: () => undefined } as unknown as ModelRuntime, {
    instanceId: ProviderInstanceId.make("piAgent"),
    sessionDir: `${config.stateDir}/pi-sessions`,
    agentDir: `${config.stateDir}/pi-agent`,
  });
  const queue = yield* Stream.toQueue(adapter.streamEvents, { capacity: "unbounded" });
  const nextCompletion = () =>
    Stream.fromQueue(queue).pipe(
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.map((events) => events.at(-1)),
    );
  const nextEvent = <T extends "user-input.requested" | "user-input.resolved">(type: T) =>
    Stream.fromQueue(queue).pipe(
      Stream.filter((event) => event.type === type),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    );
  const start = () =>
    adapter.startSession({ threadId, cwd: config.stateDir, runtimeMode: "full-access" });
  const emit = (message: Message) => {
    messages.push(message);
    listener?.({ type: "message_start", message });
    listener?.({ type: "message_end", message });
  };
  return {
    adapter,
    agent,
    start,
    emit,
    queue,
    nextCompletion,
    nextEvent,
    getExtensionUI: () => extensionUI,
    config,
    settle: () => listener?.({ type: "agent_settled" }),
  };
});

describe("PiAdapter", () => {
  it.effect("totals every model call in a turn and resets the next turn", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      yield* f.start();
      f.agent.prompt.mockImplementation(async () => {
        f.emit(assistantMessage("toolUse", 10, 5));
        f.emit(assistantMessage("stop", 20, 10));
        f.settle();
      });
      yield* f.adapter.sendTurn({ threadId, input: "do two steps" });
      expect(yield* f.nextCompletion()).toMatchObject({
        type: "turn.completed",
        payload: {
          state: "completed",
          totalCostUsd: 0.4,
          tokenUsage: {
            inputTokens: 40,
            outputTokens: 15,
            cachedInputTokens: 6,
            cacheCreationTokens: 4,
          },
        },
      });
      f.agent.prompt.mockImplementation(async () => {
        f.emit(assistantMessage("stop", 7, 1));
        f.settle();
      });
      yield* f.adapter.sendTurn({ threadId, input: "one more" });
      expect(yield* f.nextCompletion()).toMatchObject({
        payload: { totalCostUsd: 0.2, tokenUsage: { inputTokens: 12, outputTokens: 1 } },
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("finishes a handled extension command even without agent events", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      yield* f.start();
      yield* f.adapter.sendTurn({ threadId, input: "/handled-command" });
      expect(yield* f.nextCompletion()).toMatchObject({ payload: { state: "completed" } });
      expect(yield* f.adapter.listSessions()).toMatchObject([{ status: "ready" }]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("dispatches composer skill mentions through Pi's native skill command", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      yield* f.start();
      f.agent.prompt.mockImplementation(async () => f.settle());

      yield* f.adapter.sendTurn({ threadId, input: "Please $review this change" });
      yield* f.nextCompletion();
      expect(f.agent.prompt).toHaveBeenCalledWith(
        "/skill:review Please this change",
        expect.any(Object),
      );

      yield* f.adapter.sendTurn({ threadId, input: "Keep $HOME unchanged" });
      yield* f.nextCompletion();
      expect(f.agent.prompt).toHaveBeenLastCalledWith("Keep $HOME unchanged", expect.any(Object));
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("restores configured tools after a read-only plan turn", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      yield* f.start();
      f.agent.prompt.mockImplementation(async () => {
        f.settle();
      });
      yield* f.adapter.sendTurn({ threadId, input: "plan", interactionMode: "plan" });
      yield* f.nextCompletion();
      expect(f.agent.getActiveToolNames()).toEqual(["read", "grep", "find", "ls"]);
      yield* f.adapter.sendTurn({ threadId, input: "execute" });
      yield* f.nextCompletion();
      expect(f.agent.getActiveToolNames()).toEqual([
        "read",
        "bash",
        "edit",
        "write",
        "custom_tool",
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("routes Pi extension dialogs through Waypoint user input", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      yield* f.start();
      const ui = f.getExtensionUI();
      if (!ui) return yield* Effect.die("Pi extension UI was not bound");

      const selection = ui.select("Deployment", ["Preview", "Production"]);
      const selectionRequest = yield* f.nextEvent("user-input.requested");
      expect(selectionRequest).toMatchObject({
        payload: {
          questions: [
            {
              id: "selection",
              question: "Deployment",
              allowCustomAnswer: false,
              options: [{ value: "Preview" }, { value: "Production" }],
            },
          ],
        },
      });
      yield* f.adapter.respondToUserInput(
        threadId,
        ApprovalRequestId.make(selectionRequest.requestId!),
        { selection: "Production" },
      );
      expect(yield* Effect.promise(() => selection)).toBe("Production");
      expect(yield* f.nextEvent("user-input.resolved")).toMatchObject({
        payload: { answers: { selection: "Production" } },
      });

      const confirmation = ui.confirm("Delete", "Delete generated files?");
      const confirmationRequest = yield* f.nextEvent("user-input.requested");
      yield* f.adapter.respondToUserInput(
        threadId,
        ApprovalRequestId.make(confirmationRequest.requestId!),
        { confirmation: "yes" },
      );
      expect(yield* Effect.promise(() => confirmation)).toBe(true);
      yield* f.nextEvent("user-input.resolved");

      const input = ui.input("Release name", "Enter a name");
      const inputRequest = yield* f.nextEvent("user-input.requested");
      yield* f.adapter.respondToUserInput(
        threadId,
        ApprovalRequestId.make(inputRequest.requestId!),
        { input: "Aurora" },
      );
      expect(yield* Effect.promise(() => input)).toBe("Aurora");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("cancels a pending Pi extension dialog when its session stops", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      yield* f.start();
      const ui = f.getExtensionUI();
      if (!ui) return yield* Effect.die("Pi extension UI was not bound");

      const confirmation = ui.confirm("Continue", "Keep waiting?");
      yield* f.nextEvent("user-input.requested");
      yield* f.adapter.stopSession(threadId);
      expect(yield* Effect.promise(() => confirmation)).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects invalid resume cursors without replacing a working session", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      yield* f.start();
      for (const resumeCursor of [
        { schemaVersion: 1, sessionFile: `${f.config.stateDir}/outside.jsonl` },
        { schemaVersion: 2, sessionFile: f.agent.sessionFile },
        { schemaVersion: 1, sessionFile: f.agent.sessionFile },
      ]) {
        const result = yield* f.adapter
          .startSession({
            threadId,
            cwd: f.config.stateDir,
            runtimeMode: "full-access",
            resumeCursor,
          })
          .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(f.agent.dispose).not.toHaveBeenCalled();
        expect(yield* f.adapter.hasSession(threadId)).toBe(true);
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("disposes live SDK sessions when the adapter scope closes", () =>
    Effect.gen(function* () {
      const agent = yield* Effect.scoped(
        Effect.gen(function* () {
          const f = yield* makeFixture();
          yield* f.start();
          return f.agent;
        }),
      );
      expect(agent.dispose).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("persists and resumes a real SDK conversation inside Waypoint's state directory", () =>
    Effect.gen(function* () {
      const sdk = yield* Effect.promise(() =>
        vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
          "@earendil-works/pi-coding-agent",
        ),
      );
      vi.mocked(createAgentSession).mockImplementation(sdk.createAgentSession);
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const agentDir = `${config.stateDir}/pi-agent`;
      yield* fs.makeDirectory(agentDir, { recursive: true });
      const runtime = yield* Effect.promise(() =>
        sdk.ModelRuntime.create({
          authPath: `${agentDir}/auth.json`,
          modelsPath: `${agentDir}/models.json`,
          refreshOnCreate: false,
        }),
      );
      const model = runtime.getModels().find((model) => model.api === "anthropic-messages");
      if (!model) return yield* Effect.die("SDK has no static Anthropic test model");
      vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
      vi.spyOn(runtime, "checkAuth").mockResolvedValue({ type: "api_key", source: "test" });
      const message = {
        ...assistantMessage("stop", 10, 5),
        provider: model.provider,
        model: model.id,
      };
      vi.spyOn(runtime, "streamSimple").mockImplementation(
        () =>
          ({
            async *[Symbol.asyncIterator]() {
              yield { type: "done", reason: "stop", message };
            },
            result: async () => message,
          }) as unknown as ReturnType<ModelRuntime["streamSimple"]>,
      );
      const adapter = yield* makePiAdapter(runtime, {
        instanceId: ProviderInstanceId.make("piAgent"),
        agentDir,
        sessionDir: `${config.stateDir}/pi-sessions`,
      });
      const queue = yield* Stream.toQueue(adapter.streamEvents, { capacity: "unbounded" });
      const input = {
        threadId,
        cwd: config.stateDir,
        runtimeMode: "full-access" as const,
        modelSelection: {
          instanceId: ProviderInstanceId.make("piAgent"),
          model: `${model.provider}/${model.id}`,
        },
      };
      const session = yield* adapter.startSession(input);
      yield* adapter.sendTurn({ threadId, input: "Remember the word lighthouse." });
      const events = yield* Stream.fromQueue(queue).pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
      );
      expect(events.at(-1)).toMatchObject({ payload: { state: "completed", totalCostUsd: 0.2 } });
      const cursor = session.resumeCursor as { sessionFile: string };
      expect(yield* fs.readFileString(cursor.sessionFile)).toContain("lighthouse");
      yield* adapter.stopSession(threadId);
      const resumed = yield* adapter.startSession({ ...input, resumeCursor: session.resumeCursor });
      expect(resumed.resumeCursor).toEqual(session.resumeCursor);
      const resumedSdk = vi.mocked(createAgentSession).mock.results.at(-1);
      if (!resumedSdk || resumedSdk.type !== "return")
        return yield* Effect.die("Missing resumed SDK session");
      const created = yield* Effect.promise(() => resumedSdk.value);
      expect(created.session.messages).toContainEqual(
        expect.objectContaining({
          role: "user",
          content: [{ type: "text", text: "Remember the word lighthouse." }],
        }),
      );
    }).pipe(Effect.provide(testLayer)),
  );
});
