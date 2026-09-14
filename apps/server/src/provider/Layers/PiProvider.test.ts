import { PiSettings } from "@waypoint/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import {
  buildInitialPiProviderSnapshot,
  buildPiModels,
  buildPiResourceInventory,
  piModelSlug,
} from "./PiProvider.ts";

const decodeSettings = Schema.decodeSync(PiSettings);

describe("PiProvider", () => {
  it("publishes provider-qualified model slugs and reasoning controls", () => {
    const model = {
      id: "claude-sonnet-test",
      name: "Claude Sonnet Test",
      api: "anthropic-messages" as const,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      thinkingLevelMap: { low: "low", medium: "medium", high: "high" } as const,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 32_000,
    };

    expect(piModelSlug(model)).toBe("anthropic/claude-sonnet-test");
    const [published] = buildPiModels([model]);
    expect(published).toMatchObject({
      slug: "anthropic/claude-sonnet-test",
      name: "Claude Sonnet Test",
      subProvider: "Anthropic",
      isDefault: true,
    });
    expect(published?.capabilities?.optionDescriptors?.[0]).toMatchObject({
      id: "thinkingLevel",
      currentValue: "medium",
    });
  });

  it("publishes Pi skills, prompts, and extension commands for the composer", () => {
    expect(
      buildPiResourceInventory({
        skills: [
          {
            name: "review",
            description: "Review the current changes",
            filePath: "/workspace/.pi/skills/review/SKILL.md",
            disableModelInvocation: true,
            sourceInfo: { scope: "project" },
          },
        ],
        prompts: [
          {
            name: "release",
            description: "Prepare a release",
            argumentHint: "<version>",
          },
          { name: "compact", description: "Conflicts with the native command" },
        ],
        extensionCommands: [{ name: "inspect", description: "Inspect the repository" }],
      }),
    ).toEqual({
      skills: [
        {
          name: "review",
          description: "Review the current changes",
          path: "/workspace/.pi/skills/review/SKILL.md",
          scope: "project",
          enabled: true,
          userInvocationOnly: true,
        },
      ],
      slashCommands: [
        { name: "compact", description: "Summarize and compact the Pi session" },
        { name: "inspect", description: "Inspect the repository" },
        { name: "release", description: "Prepare a release", input: { hint: "<version>" } },
      ],
    });
  });

  it.effect("is installed but disabled by default", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPiProviderSnapshot(decodeSettings({}));
      expect(snapshot).toMatchObject({
        displayName: "Pi",
        enabled: false,
        installed: true,
        status: "disabled",
        models: [],
        reportsContextWindow: true,
      });
    }),
  );
});
