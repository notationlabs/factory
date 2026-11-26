import type { OutpostConfig } from "@notation/factory/router";
import { CONTAINER_CLASS, SERVICE_GATEWAY } from "./outpost-api.ts";
import type { OutpostSettings } from "./outpost-settings.ts";

/** A runtime's account, as the deployer binds it. `setup` is the script that installs the runtime's CLI. */
export type RuntimeAccount = { setup?: string };

/**
 * The layers the deployer adds to the end of every container's Dockerfile:
 * bun, which runs the runner, git, the container's runtimes' setups as
 * root, and a user other than root who owns `/data`.
 */
const factoryLayers = (runtimes: number) => `

# Notation Factory's layers, which the deployer adds to every image.
USER root
COPY --from=oven/bun:1-debian /usr/local/bin/bun /usr/local/bin/bun
RUN command -v git >/dev/null 2>&1 || { apt-get update \\
 && apt-get install -y --no-install-recommends ca-certificates git \\
 && rm -rf /var/lib/apt/lists/*; }
${
  runtimes === 0
    ? "# The container lists no runtimes."
    : `COPY factory-runtimes /tmp/factory-runtimes
RUN for setup in /tmp/factory-runtimes/*.sh; do sh "$setup"; done \\
 && rm -rf /tmp/factory-runtimes`
}
# Claude Code refuses --dangerously-skip-permissions as root.
RUN { id -u factory >/dev/null 2>&1 || useradd --create-home --home-dir /data/home --shell /bin/bash factory; } \\
 && mkdir -p /data/home \\
 && chown -R factory:factory /data
USER factory
ENV HOME=/data/home
WORKDIR /data/home
EXPOSE 8080
`;

const INSTANCE_TYPES = ["lite", "basic", "standard-1", "standard-2", "standard-3", "standard-4"];

/** The Cloudflare instance type of a container: its `instanceType`, or else `standard-1`. */
export const instanceType = (container: OutpostConfig["containers"][string]) => {
  const type = container.instanceType ?? "standard-1";
  if (!INSTANCE_TYPES.includes(type)) {
    throw new Error(`Cloudflare has no instance type \`${type}\`. Use one of ${INSTANCE_TYPES.map((t) => `\`${t}\``).join(", ")}.`);
  }
  return type;
};

/**
 * The files the deployer adds to a container's build context for its image,
 * and where the build finds the Dockerfile. The Dockerfile is the
 * container's `image`, or else Factory's default, with Factory's layers at
 * the end. It's at the root of the source, outside the build context:
 * - A container with no `image` builds with the source's root as its
 *   context, and its runtimes' setups as `factory-runtimes/<id>.sh`.
 * - A container with an `image` builds with `.factory/` as its context, and
 *   the setups as `.factory/factory-runtimes/<id>.sh`. A runtime with no
 *   setup is the image's to install.
 */
export const imageSource = (
  container: OutpostConfig["containers"][string],
  files: Record<string, string>,
  accounts: Record<string, RuntimeAccount>,
  defaultDockerfile: string,
) => {
  const source: Record<string, string> = {};
  const setups = container.runtimes.map((id) => ({ id, setup: accounts[id]?.setup }));
  let dockerfile = defaultDockerfile;
  let context = ".";
  if (container.image) {
    const path = container.image.replace(/^\.\//, "");
    const own = files[path];
    if (own === undefined) throw new Error(`The image .factory/${path} doesn't exist.`);
    dockerfile = own;
    context = "./.factory";
  } else {
    const missing = setups.find(({ setup }) => !setup);
    if (missing) {
      throw new Error(
        `The hub has no setup for the runtime ${missing.id}. Give the container an image that installs it, or deploy the hub with an account for ${missing.id}.`,
      );
    }
  }
  const dir = container.image ? ".factory/" : "";
  const installed = setups.filter(({ setup }) => setup);
  for (const { id, setup } of installed) source[`${dir}factory-runtimes/${id}.sh`] = setup!;
  source.Dockerfile = `${dockerfile.trimEnd()}${factoryLayers(installed.length)}`;
  return { source, image: "./Dockerfile", context };
};

/**
 * The `wrangler.json` of the outpost Worker `worker`, which runs the
 * container `id` of `repo`. `image` is the container's `imageSource`.
 */
export const wranglerConfig = (
  settings: OutpostSettings,
  worker: string,
  repo: string,
  id: string,
  container: OutpostConfig["containers"][string],
  image: { image: string; context: string },
) => {
  const config = {
    name: worker,
    main: "outpost.js",
    no_bundle: true,
    compatibility_date: settings.compatibilityDate,
    // Cloudflare refuses a Worker's fetch of another workers.dev URL on the
    // same account without it, and containers reply through the router's.
    compatibility_flags: ["global_fetch_strictly_public"],
    workers_dev: true,
    // Cloudflare refuses preview URLs for a Worker name over 54 characters.
    preview_urls: false,
    observability: { enabled: true },
    containers: [
      {
        // Wrangler names the application `<worker>-<class>`, and Cloudflare
        // refuses a name with `--`, which Notation's generated names have.
        name: worker.replace(/-{2,}/g, "-"),
        class_name: CONTAINER_CLASS,
        image: image.image,
        image_build_context: image.context,
        max_instances: 1,
        instance_type: instanceType(container),
        ...(settings.regions && { constraints: { regions: settings.regions } }),
      },
    ],
    durable_objects: { bindings: [{ name: "OUTPOSTS", class_name: CONTAINER_CLASS }] },
    migrations: [{ tag: "v1", new_sqlite_classes: [CONTAINER_CLASS] }],
    services: [
      { binding: "DEPLOYER", service: settings.deployer },
      { binding: "ROUTER", service: settings.routerWorker, entrypoint: SERVICE_GATEWAY },
    ],
    vars: { WORKER_NAME: worker, REPO: repo, CONTAINER: id, SLEEP_AFTER: settings.sleepAfter },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
};
