import { readFileSync } from "node:fs";
import type { CompiledExample } from "./compile.ts";

const template = readFileSync(new URL("./viewer.html", import.meta.url), "utf8");

/** A self-contained page for browsing compiled examples. The data is embedded, so it opens from disk. */
export const renderHtml = (examples: CompiledExample[]) =>
  // `<` escaped so a value can't close the script tag.
  template.replace("/*DATA*/[]", () => JSON.stringify(examples).replace(/</g, "\\u003c"));
