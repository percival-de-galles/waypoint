import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ThreadEnvMode } from "./environment.ts";
import { ProjectScriptIcon } from "./orchestration.ts";

/** File name of the checked-in Waypoint project file, resolved at the workspace root. */
export const WAYPOINT_PROJECT_FILE_NAME = "waypoint.json";

/** Public URL of the published JSON Schema for {@link WaypointProjectFile}. */
export const WAYPOINT_PROJECT_FILE_SCHEMA_URL = "https://waypoint.invalid/schema/waypoint.json";

const WAYPOINT_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const WAYPOINT_PROJECT_FILE_MAX_SCRIPTS = 50;

// Annotations go on the encoded (string) side so they survive into the
// published JSON Schema; decoding still trims and re-validates non-emptiness.
const trimmedNonEmpty = (annotations: { readonly description: string }, maxLength?: number) => {
  const annotated = Schema.String.annotate(annotations);
  const encoded =
    maxLength === undefined
      ? annotated.check(Schema.isNonEmpty())
      : annotated.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const WaypointProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty({
    description: "Display name for the script, shown in the Waypoint scripts menu.",
  }),
  command: trimmedNonEmpty({
    description: "Shell command executed in a Waypoint terminal at the project root.",
  }),
  icon: Schema.optionalKey(
    ProjectScriptIcon.annotate({
      description: 'Icon shown next to the script in the scripts menu. Defaults to "play".',
    }),
  ),
  runOnWorktreeCreate: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs automatically after a worktree is created for a new thread.",
    }),
  ),
  previewUrl: Schema.optionalKey(
    trimmedNonEmpty({
      description:
        "URL opened in the in-app browser preview when this script runs. Only honored on the desktop build.",
    }),
  ),
  autoOpenPreview: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, automatically open the preview panel at `previewUrl` the moment the script starts.",
    }),
  ),
}).annotate({
  description: "A project script that team members can import into Waypoint.",
});
export type WaypointProjectFileScript = typeof WaypointProjectFileScript.Type;

export const WaypointProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({
      description: `URL of the JSON Schema for this file, typically "${WAYPOINT_PROJECT_FILE_SCHEMA_URL}".`,
    }),
  ),
  iconPath: Schema.optionalKey(
    trimmedNonEmpty(
      {
        description:
          'Workspace-relative path to the project icon (e.g. "assets/logo.svg"). Checked before Waypoint\'s built-in icon locations.',
      },
      WAYPOINT_PROJECT_FILE_PATH_MAX_LENGTH,
    ),
  ),
  defaultThreadEnvMode: Schema.optionalKey(
    ThreadEnvMode.annotate({
      description:
        'Where new threads start for this repository: "worktree" for a fresh git worktree, "local" for the current checkout. A per-project setting in Waypoint overrides this; when neither is set, the global default applies.',
    }),
  ),
  scripts: Schema.optionalKey(
    Schema.Array(WaypointProjectFileScript)
      .annotate({
        description: "Project scripts shared with everyone who opens this repository in Waypoint.",
      })
      .check(Schema.isMaxLength(WAYPOINT_PROJECT_FILE_MAX_SCRIPTS)),
  ),
}).annotate({
  title: "Waypoint project file",
  description:
    "Checked-in project configuration for Waypoint (waypoint.json at the repository root). See https://waypoint.invalid for documentation.",
});
export type WaypointProjectFile = typeof WaypointProjectFile.Type;
