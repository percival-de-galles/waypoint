import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { WaypointProjectFile, WAYPOINT_PROJECT_FILE_SCHEMA_URL } from "@waypoint/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `waypoint.json` file contents (lenient JSONC string) and the
 * decoded {@link WaypointProjectFile}.
 */
export const WaypointProjectFileFromJson = fromLenientJson(WaypointProjectFile);

const decodeWaypointProjectFile = Schema.decodeExit(WaypointProjectFileFromJson);

/**
 * Decode raw `waypoint.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseWaypointProjectFile(contents: string): WaypointProjectFile | null {
  const decoded = decodeWaypointProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `waypoint.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link WAYPOINT_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildWaypointProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(WaypointProjectFile);
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: WAYPOINT_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
