import type { OutpostConfig } from "@notation/factory/router";

/** A runtime's account, as the deployer binds it. `setup` is the script that installs the runtime's CLI. */
export type RuntimeAccount = { setup?: string };

/** Where the default image's Dockerfile takes the container's runtimes' setups. */
const MARKER = "# factory:runtimes";

/** The layer that runs every runtime's setup, as root, before the image's user. */
const RUNTIMES_LAYER = `# The container's runtimes' setups, from the hub's plugins.
COPY factory-runtimes /tmp/factory-runtimes
RUN for setup in /tmp/factory-runtimes/*.sh; do sh "$setup"; done \\
 && rm -rf /tmp/factory-runtimes`;

/** The default image's Dockerfile, with the container's runtimes' setups at its marker. */
const withRuntimes = (dockerfile: string, runtimes: number) => {
  if (!dockerfile.includes(MARKER)) throw new Error(`The default image's Dockerfile has no \`${MARKER}\` line.`);
  return dockerfile.replace(MARKER, runtimes === 0 ? "# The container lists no runtimes." : RUNTIMES_LAYER);
};

/**
 * The files the deployer adds to a container's build context for its image,
 * and where the build finds the Dockerfile:
 * - A container with no `image` gets the default Dockerfile, with each of
 *   its runtimes' setups at the marker, as `factory-runtimes/<id>.sh`.
 * - A container with an `image` gets the setups under its `.factory/`
 *   context, and its Dockerfile runs them with the contract's two lines.
 */
export const imageSource = (
  container: OutpostConfig["containers"][string],
  files: Record<string, string>,
  accounts: Record<string, RuntimeAccount>,
  defaultDockerfile: string,
) => {
  const source: Record<string, string> = {};
  const setups = container.runtimes.map((id) => ({ id, setup: accounts[id]?.setup }));
  let image = "./Dockerfile";
  let context = ".";
  if (container.image) {
    const path = container.image.replace(/^\.\//, "");
    if (!(path in files)) throw new Error(`The image .factory/${path} doesn't exist.`);
    image = `./.factory/${path}`;
    context = "./.factory";
    for (const { id, setup } of setups) {
      if (setup) source[`.factory/factory-runtimes/${id}.sh`] = setup;
    }
  } else {
    for (const { id, setup } of setups) {
      if (!setup) {
        throw new Error(
          `The hub has no setup for the runtime ${id}. Give the container an image that installs it, or deploy the hub with an account for ${id}.`,
        );
      }
      source[`factory-runtimes/${id}.sh`] = setup;
    }
    source.Dockerfile = withRuntimes(defaultDockerfile, setups.length);
  }
  return { source, image, context };
};
