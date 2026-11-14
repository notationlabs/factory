import { defineConfig } from "@notation/core/config";

export default defineConfig({
  app: "factory-e2e",
  entry: "infra/hub.ts",
  defaultStage: "test",
});
