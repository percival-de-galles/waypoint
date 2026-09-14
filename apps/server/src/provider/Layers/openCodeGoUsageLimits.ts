/**
 * OpenCode Go subscription usage is an account endpoint, separate from the
 * OpenCode SDK. Callers resolve the account key in their own harness, then
 * use this reader to publish the same limits regardless of that harness.
 *
 * @module provider/Layers/openCodeGoUsageLimits
 */
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@waypoint/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../providerUsageLimits.ts";

const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const ROLLING_WINDOW_MINS = 5 * 60;
const WEEKLY_WINDOW_MINS = 7 * 24 * 60;

const OpenCodeGoWindow = Schema.Struct({
  status: Schema.Literals(["ok", "rate-limited"]),
  percent: Schema.Number,
  resetsAt: Schema.String,
});
const OpenCodeGoUsageResponse = Schema.Struct({
  usage: Schema.Struct({
    rolling: OpenCodeGoWindow,
    weekly: OpenCodeGoWindow,
    monthly: OpenCodeGoWindow,
  }),
});

function isoFromString(value: string): string | undefined {
  const dateTime = DateTime.make(value);
  return Option.isSome(dateTime) ? DateTime.formatIso(dateTime.value) : undefined;
}

function usageWindow(input: {
  readonly id: "rolling" | "weekly" | "monthly";
  readonly kind: ServerProviderUsageWindow["kind"];
  readonly label: string;
  readonly windowDurationMins?: number;
  readonly usage: typeof OpenCodeGoWindow.Type;
}): ServerProviderUsageWindow {
  const resetsAt = isoFromString(input.usage.resetsAt);
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    // The service's rate-limited state is definitive even if its percentage
    // lags, and the generic limits contract only carries a percentage.
    usedPercent: input.usage.status === "rate-limited" ? 100 : clampPercent(input.usage.percent),
    ...(input.windowDurationMins === undefined
      ? {}
      : { windowDurationMins: input.windowDurationMins }),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

export function openCodeGoUsageResponseToLimits(input: {
  readonly checkedAt: string;
  readonly response: typeof OpenCodeGoUsageResponse.Type;
}): ServerProviderUsageLimits {
  return makeUsageLimits({
    checkedAt: input.checkedAt,
    windows: [
      usageWindow({
        id: "rolling",
        kind: "session",
        label: "5-hour",
        windowDurationMins: ROLLING_WINDOW_MINS,
        usage: input.response.usage.rolling,
      }),
      usageWindow({
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        windowDurationMins: WEEKLY_WINDOW_MINS,
        usage: input.response.usage.weekly,
      }),
      usageWindow({
        id: "monthly",
        kind: "monthly",
        label: "Monthly",
        usage: input.response.usage.monthly,
      }),
    ],
  });
}

/** Read an OpenCode Go account allowance with a key resolved by any harness. */
export const readOpenCodeGoUsageLimits = Effect.fn("readOpenCodeGoUsageLimits")(function* (
  apiKey: string,
  checkedAt: string,
): Effect.fn.Return<ServerProviderUsageLimits, never, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  const read = Effect.gen(function* () {
    const response = yield* client
      .execute(
        HttpClientRequest.get(OPENCODE_GO_USAGE_URL).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(apiKey),
        ),
      )
      .pipe(Effect.timeout("15 seconds"));
    if (response.status === 401 || response.status === 403) {
      return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    }
    if (response.status < 200 || response.status >= 300) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "OpenCode Go could not read usage.",
      });
    }
    const payload = yield* HttpClientResponse.schemaBodyJson(OpenCodeGoUsageResponse)(response);
    return openCodeGoUsageResponseToLimits({ checkedAt, response: payload });
  });
  return yield* read.pipe(
    Effect.catch(() =>
      Effect.succeed(
        makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "OpenCode Go could not read usage.",
        }),
      ),
    ),
  );
});
