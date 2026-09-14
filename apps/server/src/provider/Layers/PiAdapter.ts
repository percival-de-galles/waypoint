// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off globalDate:off globalTimers:off -- SDK callbacks are synchronous; ids/timestamps and extension timeouts live at the SDK callback boundary.
import * as NodePath from "node:path";

import {
  AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeRequestId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type ThreadId,
  TurnId,
  type UserInputQuestion,
} from "@waypoint/contracts";
import { getModelSelectionStringOptionValue } from "@waypoint/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PubSub from "effect/PubSub";
import { isObject as isRecord } from "effect/Predicate";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { planClaudeSkillDispatch } from "../Drivers/ClaudeSkillDispatch.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("piAgent");
const PI_RESUME_VERSION = 1 as const;
const PI_THINKING_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

interface PiSessionContext {
  readonly agent: AgentSession;
  readonly unsubscribe: () => void;
  readonly configuredTools: string[];
  session: ProviderSession;
  activeTurnId: TurnId | undefined;
  activeAssistantItemId: RuntimeItemId | undefined;
  compactionItemId: RuntimeItemId | undefined;
  interrupted: boolean;
  totalProcessedTokens: number;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly pendingUserInputs: Map<ApprovalRequestId, (answers: ProviderUserInputAnswers) => void>;
}

interface PiAdapterOptions {
  readonly instanceId: ProviderInstanceId;
  readonly agentDir?: string;
  readonly sessionDir: string;
}

type PiAdapterError =
  | ProviderAdapterRequestError
  | ProviderAdapterSessionNotFoundError
  | ProviderAdapterValidationError;

function makeEventId(): EventId {
  return EventId.make(globalThis.crypto.randomUUID());
}

function makeItemId(): RuntimeItemId {
  return RuntimeItemId.make(globalThis.crypto.randomUUID());
}

function createdAt(): string {
  return new Date().toISOString();
}

function messageRole(message: unknown): string | undefined {
  return isRecord(message) && typeof message.role === "string" ? message.role : undefined;
}

function assistantUsage(message: unknown):
  | {
      readonly input: number;
      readonly output: number;
      readonly cacheRead: number;
      readonly cacheWrite: number;
      readonly reasoning?: number;
      readonly totalTokens: number;
      readonly totalCost: number;
      readonly stopReason?: string;
      readonly errorMessage?: string;
    }
  | undefined {
  if (!isRecord(message) || message.role !== "assistant" || !isRecord(message.usage)) {
    return undefined;
  }
  const usage = message.usage;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const cost = isRecord(usage.cost) ? number(usage.cost.total) : 0;
  return {
    input: number(usage.input),
    output: number(usage.output),
    cacheRead: number(usage.cacheRead),
    cacheWrite: number(usage.cacheWrite),
    ...(typeof usage.reasoning === "number" &&
    Number.isFinite(usage.reasoning) &&
    usage.reasoning >= 0
      ? { reasoning: usage.reasoning }
      : {}),
    totalTokens: number(usage.totalTokens),
    totalCost: cost,
    ...(typeof message.stopReason === "string" ? { stopReason: message.stopReason } : {}),
    ...(typeof message.errorMessage === "string" && message.errorMessage.trim()
      ? { errorMessage: message.errorMessage.trim() }
      : {}),
  };
}

function toolItemType(toolName: string) {
  const normalized = toolName.toLowerCase();
  if (normalized === "bash" || normalized === "powershell") return "command_execution" as const;
  if (normalized === "edit" || normalized === "write") return "file_change" as const;
  if (normalized.includes("web") || normalized.includes("search")) return "web_search" as const;
  return "dynamic_tool_call" as const;
}

function parseResumeCursor(raw: unknown, sessionDir: string): string | undefined {
  if (!isRecord(raw) || raw.schemaVersion !== PI_RESUME_VERSION) return undefined;
  if (typeof raw.sessionFile !== "string" || !raw.sessionFile.trim()) return undefined;
  const root = NodePath.resolve(sessionDir);
  const file = NodePath.resolve(raw.sessionFile);
  const relative = NodePath.relative(root, file);
  return relative !== "" &&
    !NodePath.isAbsolute(relative) &&
    !relative.startsWith(`..${NodePath.sep}`) &&
    relative !== ".."
    ? file
    : undefined;
}

function modelForSlug(runtime: ModelRuntime, slug: string | undefined) {
  if (!slug) return undefined;
  const separator = slug.indexOf("/");
  if (separator <= 0 || separator === slug.length - 1) return undefined;
  return runtime.getModel(slug.slice(0, separator), slug.slice(separator + 1));
}

export function rewritePiSkillMention(prompt: string, skillNames: ReadonlySet<string>): string {
  const dispatch = planClaudeSkillDispatch(prompt, skillNames);
  if (!dispatch) return prompt;
  const trailing = dispatch.commandText.slice(dispatch.skillName.length + 1);
  const argumentsText = `${dispatch.leadingText ?? ""}${trailing}`.trim();
  return `/skill:${dispatch.skillName}${argumentsText ? ` ${argumentsText}` : ""}`;
}

const PLAIN_EXTENSION_THEME = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
  strikethrough: (text: string) => text,
  getFgAnsi: () => "",
  getBgAnsi: () => "",
  getColorMode: () => "truecolor" as const,
  getThinkingBorderColor: () => (text: string) => text,
  getBashModeBorderColor: () => (text: string) => text,
} as unknown as ExtensionUIContext["theme"];

export const makePiAdapter = Effect.fn("makePiAdapter")(function* (
  modelRuntime: ModelRuntime,
  options: PiAdapterOptions,
): Effect.fn.Return<
  ProviderAdapterShape<PiAdapterError>,
  never,
  FileSystem.FileSystem | ServerConfig | Scope.Scope
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const serverConfig = yield* ServerConfig;
  const sessions = new Map<ThreadId, PiSessionContext>();
  const events = yield* Effect.acquireRelease(
    PubSub.unbounded<ProviderRuntimeEvent>(),
    PubSub.shutdown,
  );
  const runtimeContext = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(runtimeContext);
  const scope = yield* Effect.scope;
  const stopAll = () =>
    Effect.sync(() => {
      for (const ctx of sessions.values()) {
        ctx.session = { ...ctx.session, status: "closed" };
        for (const resolve of ctx.pendingUserInputs.values()) resolve({});
        ctx.pendingUserInputs.clear();
        ctx.unsubscribe();
        ctx.agent.dispose();
      }
      sessions.clear();
    });
  yield* Effect.addFinalizer(stopAll);

  const stamp = (
    ctx: PiSessionContext,
    event: Omit<
      ProviderRuntimeEvent,
      "eventId" | "createdAt" | "provider" | "providerInstanceId" | "threadId"
    >,
  ): ProviderRuntimeEvent =>
    ({
      ...event,
      eventId: makeEventId(),
      createdAt: createdAt(),
      provider: PROVIDER,
      providerInstanceId: options.instanceId,
      threadId: ctx.session.threadId,
    }) as ProviderRuntimeEvent;

  const publish = (event: ProviderRuntimeEvent) =>
    PubSub.publish(events, event).pipe(Effect.asVoid);
  const publishFromSdk = (runtimeEvents: ReadonlyArray<ProviderRuntimeEvent>) => {
    if (runtimeEvents.length === 0) return;
    runFork(Effect.forEach(runtimeEvents, publish, { discard: true }));
  };

  const extensionQuestion = (
    ctx: PiSessionContext,
    method: string,
    question: UserInputQuestion,
    options?: { readonly signal?: AbortSignal; readonly timeout?: number },
  ): Promise<ProviderUserInputAnswers> => {
    if (options?.signal?.aborted) return Promise.resolve({});
    const requestId = ApprovalRequestId.make(globalThis.crypto.randomUUID());
    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (answers: ProviderUserInputAnswers) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        options?.signal?.removeEventListener("abort", cancel);
        ctx.pendingUserInputs.delete(requestId);
        publishFromSdk([
          stamp(ctx, {
            type: "user-input.resolved",
            turnId: ctx.activeTurnId,
            requestId: RuntimeRequestId.make(requestId),
            payload: { answers },
            raw: { source: "pi.sdk.event", method: `${method}/resolved`, payload: {} },
          }),
        ]);
        resolve(answers);
      };
      const cancel = () => finish({});
      ctx.pendingUserInputs.set(requestId, finish);
      options?.signal?.addEventListener("abort", cancel, { once: true });
      if (options?.timeout && options.timeout > 0) timeout = setTimeout(cancel, options.timeout);
      publishFromSdk([
        stamp(ctx, {
          type: "user-input.requested",
          turnId: ctx.activeTurnId,
          requestId: RuntimeRequestId.make(requestId),
          payload: { questions: [question] },
          raw: { source: "pi.sdk.event", method, payload: {} },
        }),
      ]);
      if (options?.signal?.aborted) cancel();
    });
  };

  const firstAnswer = (answers: ProviderUserInputAnswers, id: string) => {
    const answer = answers[id];
    if (typeof answer === "string") return answer || undefined;
    return Array.isArray(answer)
      ? answer.find((value): value is string => typeof value === "string")
      : undefined;
  };

  const makeExtensionUI = (ctx: PiSessionContext): ExtensionUIContext => {
    const ask = (
      method: string,
      question: UserInputQuestion,
      options?: { readonly signal?: AbortSignal; readonly timeout?: number },
    ) => extensionQuestion(ctx, method, question, options);
    const title = (value: string) => value.trim() || "Pi extension";
    const ui: ExtensionUIContext = {
      async select(prompt, choices, options) {
        const id = "selection";
        const answers = await ask(
          "ui/select",
          {
            id,
            header: title(prompt),
            question: title(prompt),
            options: choices.map((choice, index) => ({
              label: choice.trim() || `Option ${index + 1}`,
              description: choice.trim(),
              value: choice,
            })),
            allowCustomAnswer: false,
          },
          options,
        );
        return firstAnswer(answers, id);
      },
      async confirm(prompt, message, options) {
        const id = "confirmation";
        const answers = await ask(
          "ui/confirm",
          {
            id,
            header: title(prompt),
            question: title(message || prompt),
            options: [
              { label: "Yes", description: "Confirm", value: "yes" },
              { label: "No", description: "Cancel", value: "no" },
            ],
            allowCustomAnswer: false,
          },
          options,
        );
        return firstAnswer(answers, id) === "yes";
      },
      async input(prompt, placeholder, options) {
        const id = "input";
        const answers = await ask(
          "ui/input",
          {
            id,
            header: title(prompt),
            question: title(placeholder || prompt),
            options: [],
            allowCustomAnswer: true,
          },
          options,
        );
        return firstAnswer(answers, id);
      },
      notify(message, type = "info") {
        if (!message.trim()) return;
        publishFromSdk([
          stamp(ctx, {
            type: "runtime.warning",
            turnId: ctx.activeTurnId,
            payload: { message: message.trim(), detail: { type } },
            raw: { source: "pi.sdk.event", method: "ui/notify", payload: { type } },
          }),
        ]);
      },
      onTerminalInput: () => () => undefined,
      setStatus() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setWorkingIndicator() {},
      setHiddenThinkingLabel() {},
      setWidget() {},
      setFooter() {},
      setHeader() {},
      setTitle() {},
      async custom() {
        return undefined as never;
      },
      pasteToEditor() {},
      setEditorText() {},
      getEditorText: () => "",
      editor: (prompt, prefill) => ui.input(prompt, prefill),
      addAutocompleteProvider() {},
      setEditorComponent() {},
      getEditorComponent: () => undefined,
      theme: PLAIN_EXTENSION_THEME,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Waypoint does not expose Pi themes." }),
      getToolsExpanded: () => false,
      setToolsExpanded() {},
    };
    return ui;
  };

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<PiSessionContext, ProviderAdapterSessionNotFoundError> => {
    const ctx = sessions.get(threadId);
    if (!ctx) {
      return Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    }
    return Effect.succeed(ctx);
  };

  const appendTurnItem = (ctx: PiSessionContext, item: unknown) => {
    const turnId = ctx.activeTurnId;
    if (!turnId) return;
    ctx.turns.find((turn) => turn.id === turnId)?.items.push(item);
  };

  const finishTurn = (ctx: PiSessionContext, message?: unknown) =>
    Effect.suspend(() => {
      const turnId = ctx.activeTurnId;
      if (!turnId || sessions.get(ctx.session.threadId) !== ctx) return Effect.void;
      const turn = ctx.turns.find((entry) => entry.id === turnId);
      const usages = (turn?.items ?? []).flatMap((item) => {
        const usage = assistantUsage(item);
        return usage ? [usage] : [];
      });
      const lastUsage = assistantUsage(message) ?? usages.at(-1);
      const usage =
        lastUsage &&
        usages.reduce<NonNullable<ReturnType<typeof assistantUsage>>>(
          (total, current) =>
            Object.assign(total, {
              input: total.input + current.input,
              output: total.output + current.output,
              cacheRead: total.cacheRead + current.cacheRead,
              cacheWrite: total.cacheWrite + current.cacheWrite,
              totalTokens: total.totalTokens + current.totalTokens,
              totalCost: total.totalCost + current.totalCost,
              ...(current.reasoning === undefined
                ? {}
                : { reasoning: (total.reasoning ?? 0) + current.reasoning }),
            }),
          {
            ...lastUsage,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            totalCost: 0,
            ...(lastUsage.reasoning === undefined ? {} : { reasoning: 0 }),
          },
        );
      ctx.activeTurnId = undefined;
      ctx.session = {
        ...ctx.session,
        status: "ready",
        activeTurnId: undefined,
        updatedAt: createdAt(),
      };
      const state = ctx.interrupted
        ? "interrupted"
        : usage?.stopReason === "error"
          ? "failed"
          : usage?.stopReason === "aborted"
            ? "interrupted"
            : "completed";
      ctx.interrupted = false;
      return publish(
        stamp(ctx, {
          type: "turn.completed",
          turnId,
          payload: {
            state,
            ...(usage?.stopReason ? { stopReason: usage.stopReason } : {}),
            ...(usage ? { usage, totalCostUsd: usage.totalCost } : {}),
            ...(usage?.errorMessage ? { errorMessage: usage.errorMessage } : {}),
            ...(usage
              ? {
                  tokenUsage: {
                    usageScope: "main_agent",
                    usageStatus: "complete",
                    inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
                    outputTokens: usage.output,
                    cachedInputTokens: usage.cacheRead,
                    cacheCreationTokens: usage.cacheWrite,
                    ...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
                    hasSubagents: false,
                  },
                }
              : {}),
          },
          raw: { source: "pi.sdk.event", method: "agent_settled", payload: {} },
        }),
      );
    });

  const handleSdkEvent = (ctx: PiSessionContext, event: AgentSessionEvent) => {
    if (sessions.get(ctx.session.threadId) !== ctx) return;
    const output: ProviderRuntimeEvent[] = [];
    const raw = (payload: unknown = {}) => ({
      source: "pi.sdk.event" as const,
      method: event.type,
      payload,
    });

    switch (event.type) {
      case "message_start": {
        if (messageRole(event.message) !== "assistant") break;
        ctx.activeAssistantItemId = makeItemId();
        output.push(
          stamp(ctx, {
            type: "item.started",
            turnId: ctx.activeTurnId,
            itemId: ctx.activeAssistantItemId,
            payload: { itemType: "assistant_message", status: "inProgress" },
            raw: raw({ role: "assistant" }),
          }),
        );
        break;
      }
      case "message_update": {
        if (!ctx.activeAssistantItemId) break;
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          output.push(
            stamp(ctx, {
              type: "content.delta",
              turnId: ctx.activeTurnId,
              itemId: ctx.activeAssistantItemId,
              payload: {
                streamKind: "assistant_text",
                delta: update.delta,
                contentIndex: update.contentIndex,
              },
              raw: raw({ type: update.type, contentIndex: update.contentIndex }),
            }),
          );
        } else if (update.type === "thinking_delta") {
          output.push(
            stamp(ctx, {
              type: "content.delta",
              turnId: ctx.activeTurnId,
              itemId: ctx.activeAssistantItemId,
              payload: {
                streamKind: "reasoning_text",
                delta: update.delta,
                contentIndex: update.contentIndex,
              },
              raw: raw({ type: update.type, contentIndex: update.contentIndex }),
            }),
          );
        }
        break;
      }
      case "message_end": {
        if (messageRole(event.message) !== "assistant" || !ctx.activeAssistantItemId) break;
        const usage = assistantUsage(event.message);
        const itemId = ctx.activeAssistantItemId;
        ctx.activeAssistantItemId = undefined;
        appendTurnItem(ctx, event.message);
        output.push(
          stamp(ctx, {
            type: "item.completed",
            turnId: ctx.activeTurnId,
            itemId,
            payload: {
              itemType: "assistant_message",
              status: usage?.stopReason === "error" ? "failed" : "completed",
              data: event.message,
            },
            raw: raw({ role: "assistant", stopReason: usage?.stopReason }),
          }),
        );
        if (usage) {
          ctx.totalProcessedTokens += usage.totalTokens;
          const usedTokens = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
          output.push(
            stamp(ctx, {
              type: "thread.token-usage.updated",
              turnId: ctx.activeTurnId,
              payload: {
                usage: {
                  usedTokens,
                  totalProcessedTokens: ctx.totalProcessedTokens,
                  inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
                  cachedInputTokens: usage.cacheRead,
                  outputTokens: usage.output,
                  ...(usage.reasoning === undefined
                    ? {}
                    : { reasoningOutputTokens: usage.reasoning }),
                  lastUsedTokens: usedTokens,
                  lastInputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
                  lastCachedInputTokens: usage.cacheRead,
                  lastOutputTokens: usage.output,
                  ...(usage.reasoning === undefined
                    ? {}
                    : { lastReasoningOutputTokens: usage.reasoning }),
                  ...(ctx.agent.model?.contextWindow
                    ? { maxTokens: ctx.agent.model.contextWindow }
                    : {}),
                  compactsAutomatically: true,
                },
              },
              raw: raw({ usage }),
            }),
          );
        }
        break;
      }
      case "tool_execution_start": {
        const itemId = RuntimeItemId.make(event.toolCallId);
        output.push(
          stamp(ctx, {
            type: "item.started",
            turnId: ctx.activeTurnId,
            itemId,
            payload: {
              itemType: toolItemType(event.toolName),
              status: "inProgress",
              title: event.toolName,
              data: { args: event.args },
            },
            raw: raw({ toolCallId: event.toolCallId, toolName: event.toolName, args: event.args }),
          }),
        );
        break;
      }
      case "tool_execution_update": {
        output.push(
          stamp(ctx, {
            type: "item.updated",
            turnId: ctx.activeTurnId,
            itemId: RuntimeItemId.make(event.toolCallId),
            payload: {
              itemType: toolItemType(event.toolName),
              status: "inProgress",
              title: event.toolName,
              data: { args: event.args, partialResult: event.partialResult },
            },
            raw: raw({ toolCallId: event.toolCallId, toolName: event.toolName }),
          }),
        );
        break;
      }
      case "tool_execution_end": {
        const completed = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        };
        appendTurnItem(ctx, completed);
        output.push(
          stamp(ctx, {
            type: "item.completed",
            turnId: ctx.activeTurnId,
            itemId: RuntimeItemId.make(event.toolCallId),
            payload: {
              itemType: toolItemType(event.toolName),
              status: event.isError ? "failed" : "completed",
              title: event.toolName,
              data: completed,
            },
            raw: raw({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              isError: event.isError,
            }),
          }),
        );
        break;
      }
      case "compaction_start": {
        ctx.compactionItemId = makeItemId();
        output.push(
          stamp(ctx, {
            type: "item.started",
            turnId: ctx.activeTurnId,
            itemId: ctx.compactionItemId,
            payload: {
              itemType: "context_compaction",
              status: "inProgress",
              title: "Compact context",
            },
            raw: raw({ reason: event.reason }),
          }),
        );
        break;
      }
      case "compaction_end": {
        const itemId = ctx.compactionItemId ?? makeItemId();
        ctx.compactionItemId = undefined;
        output.push(
          stamp(ctx, {
            type: "item.completed",
            turnId: ctx.activeTurnId,
            itemId,
            payload: {
              itemType: "context_compaction",
              status: event.aborted || event.errorMessage ? "failed" : "completed",
              title: "Compact context",
              ...(event.errorMessage ? { detail: event.errorMessage } : {}),
              data: event.result,
            },
            raw: raw({ reason: event.reason, aborted: event.aborted }),
          }),
        );
        if (!event.aborted && !event.errorMessage) {
          output.push(
            stamp(ctx, {
              type: "thread.state.changed",
              turnId: ctx.activeTurnId,
              payload: { state: "compacted" },
              raw: raw({ reason: event.reason }),
            }),
          );
        }
        break;
      }
      case "agent_settled": {
        runFork(finishTurn(ctx));
        break;
      }
      default:
        break;
    }

    publishFromSdk(output);
  };

  const startSession: ProviderAdapterShape<PiAdapterError>["startSession"] = (input) =>
    Effect.gen(function* () {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }
      if (!input.cwd?.trim()) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "cwd is required and must be non-empty.",
        });
      }

      yield* fileSystem.makeDirectory(options.sessionDir, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/create",
              detail: "Could not prepare Waypoint's Pi session directory.",
              cause,
            }),
        ),
      );

      const cwd = input.cwd.trim();
      const resumeFile = parseResumeCursor(input.resumeCursor, options.sessionDir);
      if (input.resumeCursor !== undefined && !resumeFile) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue:
            "Invalid Pi resume cursor. The session must belong to this Waypoint provider instance.",
        });
      }
      if (resumeFile) {
        const resolved = yield* Effect.all([
          fileSystem.realPath(options.sessionDir),
          fileSystem.realPath(resumeFile),
        ]).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/resume",
                detail:
                  "The saved Pi session is missing or unreadable. Restore it or start a new thread.",
                cause,
              }),
          ),
        );
        if (
          !parseResumeCursor(
            { schemaVersion: PI_RESUME_VERSION, sessionFile: resolved[1] },
            resolved[0],
          )
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "Pi session resolves outside this provider's session directory.",
          });
        }
      }
      const selectedModel = modelForSlug(modelRuntime, input.modelSelection?.model);
      if (input.modelSelection?.model && !selectedModel) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Unknown Pi model '${input.modelSelection.model}'.`,
        });
      }
      const thinkingLevel = getModelSelectionStringOptionValue(
        input.modelSelection,
        "thinkingLevel",
      );

      const created = yield* Effect.tryPromise({
        try: async () => {
          const sessionManager = resumeFile
            ? SessionManager.open(resumeFile, options.sessionDir, cwd)
            : SessionManager.create(cwd, options.sessionDir);
          return createAgentSession({
            cwd,
            ...(options.agentDir ? { agentDir: options.agentDir } : {}),
            modelRuntime,
            sessionManager,
            ...(selectedModel ? { model: selectedModel } : {}),
            ...(thinkingLevel && PI_THINKING_LEVELS.has(thinkingLevel)
              ? {
                  thinkingLevel: thinkingLevel as
                    | "minimal"
                    | "low"
                    | "medium"
                    | "high"
                    | "xhigh"
                    | "max",
                }
              : {}),
            ...(input.runtimeMode === "approval-required"
              ? { tools: ["read", "grep", "find", "ls"] }
              : {}),
          });
        },
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/create",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      const previous = sessions.get(input.threadId);
      if (previous) {
        for (const resolve of previous.pendingUserInputs.values()) resolve({});
        previous.pendingUserInputs.clear();
        previous.unsubscribe();
        previous.agent.dispose();
        sessions.delete(input.threadId);
      }
      if (input.title) created.session.setSessionName(input.title);
      const now = createdAt();
      const providerSession: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        ...(created.session.model
          ? { model: `${created.session.model.provider}/${created.session.model.id}` }
          : {}),
        threadId: input.threadId,
        resumeCursor: {
          schemaVersion: PI_RESUME_VERSION,
          sessionFile: created.session.sessionFile,
        },
        createdAt: now,
        updatedAt: now,
      };
      let ctx!: PiSessionContext;
      const unsubscribe = created.session.subscribe((event) => handleSdkEvent(ctx, event));
      ctx = {
        agent: created.session,
        unsubscribe,
        configuredTools: created.session.getActiveToolNames(),
        session: providerSession,
        activeTurnId: undefined,
        activeAssistantItemId: undefined,
        compactionItemId: undefined,
        interrupted: false,
        totalProcessedTokens: 0,
        turns: [],
        pendingUserInputs: new Map(),
      };
      sessions.set(input.threadId, ctx);

      yield* Effect.tryPromise({
        try: () =>
          created.session.bindExtensions({
            mode: "rpc",
            uiContext: makeExtensionUI(ctx),
            abortHandler: () => {
              runFork(Effect.promise(() => created.session.abort()).pipe(Effect.ignore));
            },
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "extension/bind",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            sessions.delete(input.threadId);
            ctx.unsubscribe();
            ctx.agent.dispose();
          }),
        ),
      );

      yield* Effect.forEach(
        [
          stamp(ctx, {
            type: "session.started",
            payload: {
              ...(created.modelFallbackMessage ? { message: created.modelFallbackMessage } : {}),
              resume: providerSession.resumeCursor,
            },
            raw: { source: "pi.sdk.event", method: "session.created", payload: {} },
          }),
          stamp(ctx, {
            type: "session.configured",
            payload: {
              config: {
                cwd,
                runtimeMode: input.runtimeMode,
                tools: created.session.getActiveToolNames(),
              },
            },
          }),
          stamp(ctx, { type: "session.state.changed", payload: { state: "ready" } }),
          stamp(ctx, {
            type: "thread.started",
            payload: { providerThreadId: created.session.sessionId },
          }),
        ],
        publish,
        { discard: true },
      );
      return providerSession;
    });

  const sendTurn: ProviderAdapterShape<PiAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(input.threadId);
      const text = input.input?.trim() || (input.continuation ? "Continue." : "");
      if (!text) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "input is required.",
        });
      }

      const selectedModel = modelForSlug(modelRuntime, input.modelSelection?.model);
      if (input.modelSelection?.model && !selectedModel) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Unknown Pi model '${input.modelSelection.model}'.`,
        });
      }
      if (
        selectedModel &&
        (ctx.agent.model?.provider !== selectedModel.provider ||
          ctx.agent.model.id !== selectedModel.id)
      ) {
        yield* Effect.tryPromise({
          try: () => ctx.agent.setModel(selectedModel),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/setModel",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      }
      const thinkingLevel = getModelSelectionStringOptionValue(
        input.modelSelection,
        "thinkingLevel",
      );
      if (thinkingLevel && PI_THINKING_LEVELS.has(thinkingLevel)) {
        ctx.agent.setThinkingLevel(
          thinkingLevel as "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
        );
      }
      if (input.interactionMode === "plan" || ctx.session.runtimeMode === "approval-required") {
        ctx.agent.setActiveToolsByName(["read", "grep", "find", "ls"]);
      } else {
        ctx.agent.setActiveToolsByName(ctx.configuredTools);
      }

      const imageAttachments = [] as Array<{ type: "image"; data: string; mimeType: string }>;
      const fileNotes: string[] = [];
      for (const attachment of input.attachments ?? []) {
        const filePath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!filePath) continue;
        if (attachment.type === "image") {
          const bytes = yield* fileSystem.readFile(filePath).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/readAttachment",
                  detail: `Could not read image attachment '${attachment.name}'.`,
                  cause,
                }),
            ),
          );
          imageAttachments.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: attachment.mimeType,
          });
        } else if (attachment.type === "file") {
          fileNotes.push(`Attached file '${attachment.name}' is available at: ${filePath}`);
        }
      }
      const promptWithFiles = fileNotes.length > 0 ? `${text}\n\n${fileNotes.join("\n")}` : text;
      const promptText = rewritePiSkillMention(
        promptWithFiles,
        new Set(ctx.agent.resourceLoader.getSkills().skills.map((skill) => skill.name)),
      );
      const existingTurnId = ctx.activeTurnId;
      const turnId = existingTurnId ?? TurnId.make(globalThis.crypto.randomUUID());
      if (!existingTurnId) {
        ctx.activeTurnId = turnId;
        ctx.interrupted = false;
        ctx.turns.push({ id: turnId, items: [] });
        ctx.session = {
          ...ctx.session,
          status: "running",
          activeTurnId: turnId,
          ...(ctx.agent.model
            ? { model: `${ctx.agent.model.provider}/${ctx.agent.model.id}` }
            : {}),
          updatedAt: createdAt(),
        };
        yield* publish(
          stamp(ctx, {
            type: "turn.started",
            turnId,
            payload: {
              ...(ctx.session.model ? { model: ctx.session.model } : {}),
              ...(thinkingLevel ? { effort: thinkingLevel } : {}),
            },
          }),
        );
      }

      yield* Effect.forkIn(
        Effect.tryPromise({
          try: () =>
            ctx.agent.prompt(promptText, {
              ...(imageAttachments.length > 0 ? { images: imageAttachments } : {}),
              ...(existingTurnId ? { streamingBehavior: "steer" as const } : {}),
            }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/prompt",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            !existingTurnId && ctx.activeTurnId === turnId && ctx.agent.isIdle
              ? finishTurn(ctx)
              : Effect.void,
          ),
          Effect.catch((cause) =>
            Effect.gen(function* () {
              if (sessions.get(input.threadId) !== ctx || ctx.activeTurnId !== turnId) return;
              yield* publish(
                stamp(ctx, {
                  type: "runtime.error",
                  turnId,
                  payload: {
                    message: cause.detail,
                    class: "provider_error",
                  },
                  raw: { source: "pi.sdk.event", method: "prompt.error", payload: {} },
                }),
              );
              yield* finishTurn(ctx, {
                role: "assistant",
                stopReason: "error",
                errorMessage: cause.detail,
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { total: 0 },
                },
              });
            }),
          ),
        ),
        scope,
      );

      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: ctx.session.resumeCursor,
      };
    });

  const unsupportedRequest = (method: string): Effect.Effect<never, ProviderAdapterRequestError> =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method,
        detail:
          "Pi's embedded SDK does not expose an interactive approval request for this operation.",
      }),
    );

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
      promptlessTurnContinuation: false,
      supportsConversationRollback: false,
    },
    startSession,
    sendTurn,
    compaction: {
      type: "native",
      start: (threadId) =>
        requireSession(threadId).pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise({
              try: () => ctx.agent.compact().then(() => undefined),
              catch: (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/compact",
                  detail: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            }),
          ),
        ),
    },
    interruptTurn: (threadId, turnId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (turnId && ctx.activeTurnId && turnId !== ctx.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "interruptTurn",
            issue: `Turn '${turnId}' is not active.`,
          });
        }
        ctx.interrupted = true;
        for (const resolve of ctx.pendingUserInputs.values()) resolve({});
        ctx.pendingUserInputs.clear();
        yield* Effect.tryPromise({
          try: () => ctx.agent.abort(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/abort",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      }),
    respondToRequest: (
      _threadId: ThreadId,
      _requestId: ApprovalRequestId,
      _decision: ProviderApprovalDecision,
    ) => unsupportedRequest("request/respond"),
    respondToUserInput: (threadId, requestId, answers) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const resolve = ctx.pendingUserInputs.get(requestId);
        if (!resolve) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "userInput/respond",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }
        resolve(answers);
      }),
    stopSession: (threadId) =>
      requireSession(threadId).pipe(
        Effect.flatMap((ctx) =>
          Effect.gen(function* () {
            if (ctx.agent.isStreaming) {
              ctx.interrupted = true;
              yield* Effect.tryPromise(() => ctx.agent.abort()).pipe(Effect.ignore);
            }
            for (const resolve of ctx.pendingUserInputs.values()) resolve({});
            ctx.pendingUserInputs.clear();
            ctx.unsubscribe();
            ctx.agent.dispose();
            sessions.delete(threadId);
            ctx.session = { ...ctx.session, status: "closed", updatedAt: createdAt() };
            yield* publish(
              stamp(ctx, {
                type: "session.exited",
                payload: { exitKind: "graceful" },
              }),
            );
          }),
        ),
      ),
    listSessions: () => Effect.sync(() => [...sessions.values()].map((ctx) => ctx.session)),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread: (threadId) =>
      requireSession(threadId).pipe(
        Effect.map((ctx) => ({ threadId, turns: ctx.turns.map((turn) => ({ ...turn })) })),
      ),
    rollbackThread: (threadId, numTurns) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        if (numTurns < 1 || !Number.isInteger(numTurns)) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        return yield* unsupportedRequest("thread/rollback");
      }),
    stopAll,
    streamEvents: Stream.fromPubSub(events),
  } satisfies ProviderAdapterShape<PiAdapterError>;
});
