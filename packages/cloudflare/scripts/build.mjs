import { build } from "esbuild";

for (const worker of ["router", "deployer"]) {
  await build({
    entryPoints: [new URL(`../workers/${worker}.ts`, import.meta.url).pathname],
    outfile: new URL(`../dist/${worker}/index.mjs`, import.meta.url).pathname,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    external: ["cloudflare:workers"],
    logLevel: "warning",
  });
}
