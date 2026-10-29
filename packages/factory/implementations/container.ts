import { ResourceGroup, type ResourceOpts } from "@notation/resource";
import * as v from "valibot";
import type { PolicyContract, Runtime } from "../contracts/outpost.ts";
import { currentOutpost } from "./outpost.ts";

const containerConfig = v.object({
  image: v.string(),
  runtimes: v.optional(
    v.array(v.object({ id: v.string(), setup: v.string() })),
    [],
  ),
  /** `~/…` paths written to `/data/home` at startup: a string is a file in `.factory/`, an object is written as JSON. */
  files: v.optional(
    v.record(
      v.string(),
      v.union([v.string(), v.record(v.string(), v.unknown())]),
    ),
    {},
  ),
});
export type ContainerConfig = v.InferInput<typeof containerConfig>;

export type ContainerOptions = ResourceOpts<
  ContainerConfig,
  { policies?: PolicyContract[] }
>;

/** A repo's machine: its image, the runtimes it installs, and the policies it may mint credentials for. */
export class Container extends ResourceGroup<ContainerConfig> {
  readonly runtimes: Runtime[];
  readonly policies: PolicyContract[];

  constructor({ id, config, dependencies }: ContainerOptions) {
    const { image, runtimes, files } = v.parse(containerConfig, config);
    const policies = dependencies?.policies ?? [];
    const seen = new Set<string>();
    for (const runtime of runtimes) {
      if (seen.has(runtime.id))
        throw new Error(`container ${id} lists runtime ${runtime.id} twice`);
      seen.add(runtime.id);
    }
    super("factory/Container", { id, config });
    this.runtimes = runtimes;
    this.policies = policies;
    currentOutpost().store.contribute(
      {
        containers: {
          [id]: {
            image,
            runtimes: runtimes.map((r) => r.id),
            policies: policies.map((p) => p.id),
            files,
          },
        },
      },
      { by: `container ${id}` },
    );
  }
}
