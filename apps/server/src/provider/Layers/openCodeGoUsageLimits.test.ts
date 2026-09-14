import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  openCodeGoUsageResponseToLimits,
  readOpenCodeGoUsageLimits,
} from "./openCodeGoUsageLimits.ts";

const checkedAt = "2026-09-14T08:00:00.000Z";
const usage = {
  usage: {
    rolling: { status: "ok" as const, percent: 12.5, resetsAt: "2026-09-14T12:00:00Z" },
    weekly: { status: "rate-limited" as const, percent: 87, resetsAt: "2026-09-19T08:00:00Z" },
    monthly: { status: "ok" as const, percent: 51, resetsAt: "2026-10-01T00:00:00Z" },
  },
};

function http(response: Response) {
  return HttpClient.make((request) =>
    Effect.sync(() => {
      expect(request.url).toBe("https://opencode.ai/zen/go/v1/usage");
      expect(request.headers.authorization).toBe("Bearer go-secret");
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
}

describe("OpenCode Go usage limits", () => {
  it("maps the account's rolling, weekly, and monthly windows", () => {
    expect(openCodeGoUsageResponseToLimits({ checkedAt, response: usage })).toEqual({
      checkedAt,
      windows: [
        {
          id: "rolling",
          kind: "session",
          label: "5-hour",
          usedPercent: 12.5,
          windowDurationMins: 300,
          resetsAt: "2026-09-14T12:00:00.000Z",
        },
        {
          id: "weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 100,
          windowDurationMins: 10080,
          resetsAt: "2026-09-19T08:00:00.000Z",
        },
        {
          id: "monthly",
          kind: "monthly",
          label: "Monthly",
          usedPercent: 51,
          resetsAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
  });

  it.effect("uses a direct bearer request and never publishes an entitlement error", () =>
    Effect.gen(function* () {
      const limits = yield* readOpenCodeGoUsageLimits("go-secret", checkedAt).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          http(Response.json({ error: "private" }, { status: 403 })),
        ),
      );
      expect(limits).toEqual({
        checkedAt,
        windows: [],
        unavailable: { reason: "unsupported" },
      });
    }),
  );

  it.effect("keeps malformed or failed responses bounded", () =>
    Effect.gen(function* () {
      const limits = yield* readOpenCodeGoUsageLimits("go-secret", checkedAt).pipe(
        Effect.provideService(HttpClient.HttpClient, http(Response.json({ status: "unexpected" }))),
      );
      expect(limits).toEqual({
        checkedAt,
        windows: [],
        unavailable: { reason: "probeFailed", message: "OpenCode Go could not read usage." },
      });
    }),
  );
});
