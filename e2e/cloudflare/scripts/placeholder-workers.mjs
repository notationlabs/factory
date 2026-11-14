import { mkdir, writeFile } from "node:fs/promises";

// The router and deployer Workers don't exist yet. These stand in for their
// bundles so that the hub can deploy.
const dist = new URL("../../../packages/cloudflare/dist/", import.meta.url);

const workers = {
  router: `import { DurableObject } from "cloudflare:workers";
export class RouterContainer extends DurableObject {}
export default { fetch: () => new Response("factory router placeholder") };
`,
  deployer: `export default { fetch: () => new Response("factory deployer placeholder") };
`,
};

for (const [name, code] of Object.entries(workers)) {
  const dir = new URL(`${name}/`, dist);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL("index.mjs", dir), code);
}
