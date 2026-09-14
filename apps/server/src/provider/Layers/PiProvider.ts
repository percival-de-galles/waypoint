import {
  type PiSettings,
  type ServerProviderModel,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@waypoint/contracts";
import { createModelCapabilities } from "@waypoint/shared/model";
import { ModelRuntime, VERSION } from "@earendil-works/pi-coding-agent";
import * as DateTime from "effect/DateTime";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { buildServerProvider, type ServerProviderDraft } from "../providerSnapshot.ts";

const PI_PRESENTATION = {
  displayName: "Pi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  reportsContextWindow: true,
} as const;

export const PI_COMPACT_COMMAND = {
  name: "compact",
  description: "Summarize and compact the Pi session",
} satisfies ServerProviderSlashCommand;

type PiModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

class PiModelDiscoveryError extends Data.TaggedError("PiModelDiscoveryError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

function titleCase(value: string): string {
  return value
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function modelCapabilities(model: PiModel) {
  if (!model.reasoning) {
    return createModelCapabilities({ optionDescriptors: [] });
  }

  const configuredLevels = Object.entries(model.thinkingLevelMap ?? {})
    .filter(([level, mapped]) => level !== "off" && mapped !== null)
    .map(([level]) => level);
  const levels = configuredLevels.length > 0 ? configuredLevels : ["low", "medium", "high"];
  const defaultLevel = levels.includes("medium") ? "medium" : levels[0];

  return createModelCapabilities({
    optionDescriptors: [
      {
        id: "thinkingLevel",
        label: "Reasoning",
        type: "select",
        options: levels.map((level) => ({
          id: level,
          label: titleCase(level),
          ...(level === defaultLevel ? { isDefault: true as const } : {}),
        })),
        ...(defaultLevel ? { currentValue: defaultLevel } : {}),
      },
    ],
  });
}

export function piModelSlug(model: Pick<PiModel, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

export function buildPiModels(models: readonly PiModel[]): ReadonlyArray<ServerProviderModel> {
  return models.map((model, index) => ({
    slug: piModelSlug(model),
    name: model.name,
    subProvider: titleCase(model.provider),
    isCustom: false,
    ...(index === 0 ? { isDefault: true } : {}),
    capabilities: modelCapabilities(model),
  }));
}

export function buildPiResourceInventory(input: {
  readonly skills: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly filePath: string;
    readonly disableModelInvocation: boolean;
    readonly sourceInfo: { readonly scope: string };
  }>;
  readonly prompts: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly argumentHint?: string;
  }>;
  readonly extensionCommands: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
  }>;
}): {
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
} {
  const skills = input.skills.flatMap((skill) => {
    const name = skill.name.trim();
    if (!name || !skill.filePath.trim()) return [];
    return [
      {
        name,
        path: skill.filePath,
        scope: skill.sourceInfo.scope,
        enabled: true,
        ...(skill.description.trim() ? { description: skill.description.trim() } : {}),
        ...(skill.disableModelInvocation ? { userInvocationOnly: true } : {}),
      } satisfies ServerProviderSkill,
    ];
  });
  const commands: ReadonlyArray<ServerProviderSlashCommand> = [
    ...input.extensionCommands.map((command) => ({
      name: command.name,
      description: command.description,
    })),
    ...input.prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      ...(prompt.argumentHint ? { input: { hint: prompt.argumentHint } } : {}),
    })),
  ];
  const seen = new Set([PI_COMPACT_COMMAND.name]);
  const slashCommands = commands.flatMap((command) => {
    const name = command.name.trim();
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const description = command.description?.trim();
    return [
      {
        name,
        ...(description ? { description } : {}),
        ...(command.input ? { input: command.input } : {}),
      } satisfies ServerProviderSlashCommand,
    ];
  });
  return { skills, slashCommands: [PI_COMPACT_COMMAND, ...slashCommands] };
}

export const buildInitialPiProviderSnapshot = Effect.fn("buildInitialPiProviderSnapshot")(
  function* (settings: PiSettings): Effect.fn.Return<ServerProviderDraft> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: [],
      slashCommands: [PI_COMPACT_COMMAND],
      probe: settings.enabled
        ? {
            installed: true,
            version: VERSION,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Pi models and credentials...",
          }
        : {
            installed: true,
            version: VERSION,
            status: "warning",
            auth: { status: "unknown" },
            message: "Pi is disabled in Waypoint settings.",
          },
    });
  },
);

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  settings: PiSettings,
  runtime: ModelRuntime,
): Effect.fn.Return<ServerProviderDraft> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return yield* buildInitialPiProviderSnapshot(settings);
  }

  const available = yield* Effect.tryPromise({
    try: () => runtime.getAvailable(),
    catch: (cause) =>
      new PiModelDiscoveryError({
        cause,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  }).pipe(Effect.result);

  if (available._tag === "Failure") {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: buildPiModels(runtime.getAvailableSnapshot()),
      slashCommands: [PI_COMPACT_COMMAND],
      probe: {
        installed: true,
        version: VERSION,
        status: "error",
        auth: { status: "unknown" },
        message: `Pi model discovery failed: ${available.failure.message}`,
      },
    });
  }

  const models = buildPiModels(available.success);
  const runtimeError = runtime.getError();
  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    slashCommands: [PI_COMPACT_COMMAND],
    probe: {
      installed: true,
      version: VERSION,
      status: models.length > 0 ? "ready" : "warning",
      auth: { status: models.length > 0 ? "authenticated" : "unauthenticated" },
      ...(runtimeError
        ? { message: runtimeError }
        : models.length === 0
          ? {
              message:
                "Pi is available, but no authenticated models were found. Configure Pi credentials in its agent directory.",
            }
          : {}),
    },
  });
});
