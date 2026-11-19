/**
 * The packages that an outpost's config can import, each with the SDK module
 * it resolves to. The SDK is built from each package's `factory-outpost`
 * export, or its default export.
 */
export const SDK_PACKAGES = {
  "@notation/factory": "factory",
  "@notation/factory-github": "factory-github",
  "@notation/factory-claude": "factory-claude",
  "@notation/factory-cursor": "factory-cursor",
  "@notation/factory-droid": "factory-droid",
  "@notation/factory-slack": "factory-slack",
} as const;

/** The SDK module that runs a config and collects its outpost config. */
export const SDK_COLLECT = "collect";

/** The directory that SDK modules are under, among the modules evaluated. */
export const SDK_DIR = "sdk";
