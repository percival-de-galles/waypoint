/** Completed turns driven by Waypoint but not written to a provider CLI transcript. */
import * as NodeFSP from "node:fs/promises";

import type { UsageProviderKind, UsageTokenTotals } from "@waypoint/contracts";

import type { UsageRecord } from "./usageTranscripts.ts";

export interface RuntimeUsageLedgerRecord {
  readonly eventId: string;
  readonly timestampMs: number;
  readonly provider: Extract<UsageProviderKind, "opencode" | "piAgent">;
  readonly model: string;
  readonly sessionId: string;
  readonly totals: UsageTokenTotals;
  readonly reportedCostUsd: number | null;
}

export function toUsageRecord(record: RuntimeUsageLedgerRecord): UsageRecord {
  return { ...record, dedupeKey: record.eventId };
}

function isTotals(value: unknown): value is UsageTokenTotals {
  if (value === null || typeof value !== "object") return false;
  const totals = value as Record<string, unknown>;
  return [
    totals.uncachedInputTokens,
    totals.cachedInputTokens,
    totals.cacheCreationTokens,
    totals.outputTokens,
    totals.reasoningTokens,
  ].every((tokenCount) => typeof tokenCount === "number" && Number.isFinite(tokenCount) && tokenCount >= 0);
}

export async function appendRuntimeUsageRecord(path: string, record: RuntimeUsageLedgerRecord) {
  await NodeFSP.appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readRuntimeUsageRecords(path: string): Promise<readonly UsageRecord[]> {
  let contents: string;
  try {
    contents = await NodeFSP.readFile(path, "utf8");
  } catch {
    return [];
  }
  const records: UsageRecord[] = [];
  for (const line of contents.split("\n")) {
    try {
      const value = JSON.parse(line) as RuntimeUsageLedgerRecord;
      if (
        (value.provider === "opencode" || value.provider === "piAgent") &&
        typeof value.eventId === "string" &&
        typeof value.timestampMs === "number" && Number.isFinite(value.timestampMs) &&
        typeof value.model === "string" &&
        value.model.length > 0 &&
        isTotals(value.totals) &&
        (value.reportedCostUsd === null ||
          (typeof value.reportedCostUsd === "number" && Number.isFinite(value.reportedCostUsd)))
      ) {
        records.push(toUsageRecord(value));
      }
    } catch {
      // An interrupted final append does not invalidate later records.
    }
  }
  return records;
}
