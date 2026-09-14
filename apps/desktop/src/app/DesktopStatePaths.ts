import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(waypointHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(waypointHome)) {
    return Option.none();
  }
  const trimmed = waypointHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly waypointHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.waypointHome), () =>
    input.joinPath(input.homeDirectory, ".waypoint"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly waypointHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.waypointHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
