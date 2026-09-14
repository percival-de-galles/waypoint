import {
  WAYPOINT_PROJECT_FILE_NAME,
  type EnvironmentId,
  type WaypointProjectFile,
  type WaypointProjectFileScript,
} from "@waypoint/contracts";
import { parseWaypointProjectFile } from "@waypoint/shared/waypointProjectFile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<WaypointProjectFileScript> = [];

export interface WaypointProjectFileState {
  /**
   * - `valid`: waypoint.json exists and decoded.
   * - `invalid`: waypoint.json exists but fails to decode (the server then ignores
   *   the whole file, including `iconPath` and every script).
   * - `missing`: no readable waypoint.json at the workspace root.
   * - `loading`: the file query has not settled yet.
   */
  status: "loading" | "missing" | "invalid" | "valid";
  /** The decoded file when status is `valid`, null otherwise. */
  file: WaypointProjectFile | null;
  scripts: ReadonlyArray<WaypointProjectFileScript>;
}

/**
 * Decoded state of the project's checked-in `waypoint.json`, including whether the
 * file exists but is broken — which the runtime otherwise swallows silently.
 */
export function useWaypointProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): WaypointProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", WAYPOINT_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  return useMemo(() => {
    if (contents === null) {
      return {
        status: isPending ? "loading" : "missing",
        file: null,
        scripts: NO_SCRIPTS,
      } as const;
    }
    const file = parseWaypointProjectFile(contents);
    if (file === null) {
      return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
    }
    return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
  }, [contents, isPending]);
}

/**
 * Scripts declared in the project's checked-in `waypoint.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useWaypointProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<WaypointProjectFileScript> {
  return useWaypointProjectFileState(environmentId, cwd).scripts;
}
