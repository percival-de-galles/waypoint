import type { APIRoute } from "astro";

import { buildWaypointProjectFileJsonSchema } from "@waypoint/shared/waypointProjectFile";

// Rendered at build time; published at https://waypoint.invalid/schema/waypoint.json so
// waypoint.json files can reference it via "$schema" for editor/LSP support.
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildWaypointProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
