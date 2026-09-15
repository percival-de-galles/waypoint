import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { appendRuntimeUsageRecord, readRuntimeUsageRecords, toUsageRecord } from "./runtimeUsageLedger.ts";

describe("runtime usage ledger", () => {
  it("turns a completed Pi or OpenCode turn into a de-duplicable usage record", () => {
    expect(
      toUsageRecord({
        eventId: "event-1",
        timestampMs: 1_700_000_000_000,
        provider: "opencode",
        model: "openai/gpt-5",
        sessionId: "thread-1",
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 20,
          cacheCreationTokens: 0,
          outputTokens: 50,
          reasoningTokens: 10,
        },
        reportedCostUsd: null,
      }),
    ).toMatchObject({ provider: "opencode", model: "openai/gpt-5", dedupeKey: "event-1" });
  });

  it("keeps valid records when an interrupted append leaves a malformed line", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "waypoint-usage-"));
    const path = NodePath.join(directory, "runtime.jsonl");
    try {
      await appendRuntimeUsageRecord(path, {
        eventId: "event-1",
        timestampMs: 1_700_000_000_000,
        provider: "piAgent",
        model: "anthropic/claude-sonnet",
        sessionId: "thread-1",
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 50,
          reasoningTokens: 0,
        },
        reportedCostUsd: 0.01,
      });
      await NodeFSP.appendFile(path, "{broken\n");
      expect(await readRuntimeUsageRecords(path)).toMatchObject([{ dedupeKey: "event-1" }]);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
});
