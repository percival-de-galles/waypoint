import { requireOptionalNativeModule } from "expo";

interface WaypointMarkdownTextSelectionNativeModule {
  readonly installCopySanitizer: (reactTag: number) => void;
}

const nativeModule =
  requireOptionalNativeModule<WaypointMarkdownTextSelectionNativeModule>("WaypointMarkdownTextSelection");

export function installMarkdownCopySanitizer(reactTag: number): void {
  nativeModule?.installCopySanitizer(reactTag);
}
