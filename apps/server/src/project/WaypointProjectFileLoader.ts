/**
 * WaypointProjectFileLoader - Effect service that loads the checked-in `waypoint.json`
 * project file from a workspace root.
 *
 * Loading is best-effort: a missing file resolves to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * can fall back to their defaults.
 *
 * @module WaypointProjectFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { WAYPOINT_PROJECT_FILE_NAME, type WaypointProjectFile } from "@waypoint/contracts";
import { WaypointProjectFileFromJson } from "@waypoint/shared/waypointProjectFile";

const decodeWaypointProjectFileJson = Schema.decodeEffect(WaypointProjectFileFromJson);

export class WaypointProjectFileLoadError extends Schema.TaggedError<WaypointProjectFileLoadError>()(
  "WaypointProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${WAYPOINT_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

/** Service tag for waypoint.json project file loading. */
export class WaypointProjectFileLoader extends Context.Service<
  WaypointProjectFileLoader,
  {
    /**
     * Load and decode `waypoint.json` at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<WaypointProjectFile>>;
  }
>()("waypoint/project/WaypointProjectFileLoader") {}

const logWaypointProjectFileLoadError = (error: WaypointProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: WaypointProjectFileLoader["Service"]["load"] = Effect.fn("WaypointProjectFileLoader.load")(
    function* (workspaceRoot) {
      const filePath = path.join(workspaceRoot, WAYPOINT_PROJECT_FILE_NAME);
      const raw = yield* fileSystem.readFileString(filePath).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<string>())
              : logWaypointProjectFileLoadError(
                  new WaypointProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<string>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<WaypointProjectFile>();
      }
      return yield* decodeWaypointProjectFileJson(raw.value).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          SchemaError: (error) =>
            logWaypointProjectFileLoadError(
              new WaypointProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<WaypointProjectFile>())),
        }),
      );
    },
  );

  return WaypointProjectFileLoader.of({ load });
});

export const layer = Layer.effect(WaypointProjectFileLoader, make);
