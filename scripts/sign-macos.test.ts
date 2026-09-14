import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { expect, it, vi } from "vite-plus/test";

import sign from "./sign-macos.ts";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));

it("batches codesign calls without changing existing signing options", async () => {
  const options = {
    app: "/tmp/Waypoint.app",
    identity: "Developer ID Application: Waypoint Tools, Inc.",
    keychain: "/tmp/waypoint.keychain",
    provisioningProfile: "/tmp/waypoint.provisionprofile",
    optionsForFile: () => ({
      entitlements: "/tmp/waypoint.entitlements.plist",
      hardenedRuntime: true,
    }),
  } satisfies SignOptions;

  await sign(options);

  expect(signApplication).toHaveBeenCalledExactlyOnceWith({
    ...options,
    batchCodesignCalls: true,
  });
});
