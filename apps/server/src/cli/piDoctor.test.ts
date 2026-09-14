import { assert, it } from "@effect/vitest";

import { buildPiDoctorReport, formatPiDoctorReport } from "./piDoctor.ts";

const base = {
  sdkVersion: "0.85.1",
  cwd: "/work/project",
  agentDir: "/home/user/.pi/agent",
  isolatedState: true as const,
  models: [{ provider: "anthropic", id: "claude", name: "Claude" }],
  resources: { skills: 2, prompts: 1, extensions: 1, commands: 3 },
  diagnostics: [] as string[],
  live: { attempted: false } as const,
};

it("classifies Pi diagnostics and explains that live requests are opt-in", () => {
  const ready = buildPiDoctorReport(base);
  assert.equal(ready.status, "ready");
  assert.include(formatPiDoctorReport(ready), "Live request: skipped (pass --prompt to run one)");

  assert.equal(buildPiDoctorReport({ ...base, models: [] }).status, "warning");
  assert.equal(
    buildPiDoctorReport({
      ...base,
      live: { attempted: true, passed: false, streamed: false, error: "Unauthorized" },
    }).status,
    "error",
  );
});
