import { PiSettings, ProviderDriverKind } from "@waypoint/contracts";
import { createAgentSessionServices, ModelRuntime } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makePiTextGeneration } from "../../textGeneration/PiTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makePiAdapter } from "../Layers/PiAdapter.ts";
import {
  buildInitialPiProviderSnapshot,
  buildPiResourceInventory,
  checkPiProviderStatus,
} from "../Layers/PiProvider.ts";
import { readOpenCodeGoUsageLimits } from "../Layers/openCodeGoUsageLimits.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";

const DRIVER = ProviderDriverKind.make("piAgent");
const decodeSettings = Schema.decodeSync(PiSettings);
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER,
  packageName: null,
});

export type PiDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ServerConfig
  | ServerSettingsService;

export const PiDriver: ProviderDriver<PiSettings, PiDriverEnv> = {
  driverKind: DRIVER,
  metadata: {
    displayName: "Pi",
    // Pi's request runtime can consult ambient provider environment variables.
    // Keep a single embedded runtime until the SDK exposes per-session env injection.
    supportsMultipleInstances: false,
  },
  configSchema: PiSettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, enabled, config }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const serverSettings = yield* ServerSettingsService;
      const httpClient = yield* HttpClient.HttpClient;
      const settings = { ...config, enabled } satisfies PiSettings;
      const agentDir = settings.agentDir
        ? path.resolve(expandHomePath(settings.agentDir))
        : undefined;
      const modelRuntime = yield* Effect.tryPromise({
        try: () =>
          ModelRuntime.create({
            modelsStorePath: path.join(
              serverConfig.stateDir,
              "providers",
              instanceId,
              "pi-models-store.json",
            ),
            ...(agentDir
              ? {
                  authPath: path.join(agentDir, "auth.json"),
                  modelsPath: path.join(agentDir, "models.json"),
                }
              : {}),
            refreshOnCreate: settings.enabled,
          }),
        catch: (cause) =>
          new ProviderDriverError({
            driver: DRIVER,
            instanceId,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const stampSnapshot = (snapshot: Parameters<typeof stampIdentity>[0]) => ({
        ...stampIdentity(snapshot),
        supportsConversationRollback: false,
        supportsTextGeneration: false,
      });

      const adapter = yield* makePiAdapter(modelRuntime, {
        instanceId,
        ...(agentDir ? { agentDir } : {}),
        sessionDir: path.join(serverConfig.stateDir, "providers", instanceId, "pi-sessions"),
      });
      const snapshotSettings = makeProviderSnapshotSettingsSource(settings, serverSettings);
      const checkProvider = checkPiProviderStatus(settings, modelRuntime).pipe(
        Effect.flatMap((provider) => {
          return Effect.tryPromise({
            try: () => modelRuntime.getAuth("opencode-go"),
            // A missing or malformed optional Go credential must not make Pi's
            // normal provider probe fail.
            catch: (cause) => cause,
          }).pipe(
            Effect.orElseSucceed(() => undefined),
            Effect.flatMap((auth) => {
              const apiKey = auth?.auth.apiKey?.trim();
              return apiKey
                ? readOpenCodeGoUsageLimits(apiKey, provider.checkedAt).pipe(
                    Effect.provideService(HttpClient.HttpClient, httpClient),
                    Effect.map((usageLimits) => ({
                      ...provider,
                      usageLimits,
                      usageLimitsDisplayName: "OpenCode Go",
                      usageLimitsDriver: ProviderDriverKind.make("opencode"),
                      usageLimitsSourceDriver: DRIVER,
                    })),
                  )
                : Effect.succeed(provider);
            }),
          );
        }),
        Effect.map(stampSnapshot),
      );
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<PiSettings>>({
        resolveMaintenance: () => Effect.succeed(MAINTENANCE_CAPABILITIES),
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (current) =>
          buildInitialPiProviderSnapshot(current.provider).pipe(Effect.map(stampSnapshot)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER,
              instanceId,
              detail: `Failed to build Pi snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const snapshotForCwd = (cwd: string) =>
        !settings.enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              Effect.tryPromise({
                try: async () => {
                  const services = await createAgentSessionServices({
                    cwd,
                    ...(agentDir ? { agentDir } : {}),
                    modelRuntime,
                    resourceLoaderOptions: { noThemes: true, noContextFiles: true },
                  });
                  const resources = services.resourceLoader;
                  return buildPiResourceInventory({
                    skills: resources.getSkills().skills,
                    prompts: resources.getPrompts().prompts,
                    extensionCommands: resources
                      .getExtensions()
                      .extensions.flatMap((extension) => [...extension.commands.values()]),
                  });
                },
                catch: (cause) =>
                  new ProviderDriverError({
                    driver: DRIVER,
                    instanceId,
                    detail: `Failed to discover Pi resources for '${cwd}'.`,
                    cause,
                  }),
              }).pipe(Effect.timeout("20 seconds")),
            ]).pipe(
              Effect.map(([machineSnapshot, inventory]) => ({
                ...machineSnapshot,
                skills: inventory.skills,
                slashCommands: inventory.slashCommands,
              })),
              Effect.mapError(
                (cause) =>
                  new ProviderDriverError({
                    driver: DRIVER,
                    instanceId,
                    detail: `Failed to discover Pi resources for '${cwd}'.`,
                    cause,
                  }),
              ),
            );

      return {
        instanceId,
        driverKind: DRIVER,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd,
        adapter,
        textGeneration: makePiTextGeneration(),
      } satisfies ProviderInstance;
    }),
};
