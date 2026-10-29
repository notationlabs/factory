import { UNKNOWN_AFTER_APPLY } from "./diff-params";
import type { BaseResource } from "./resource";

/*
 * Contributions.
 *
 * A schema marks a param as collected and says how contributions to it are
 * combined. Any code can contribute to it while infra is evaluated. Values
 * can include output values: placeholders for another resource's outputs,
 * which make the contributor's target depend on that resource and are filled
 * in at deploy.
 */

// ── Output values ──

const OUTPUT_VALUE = Symbol.for("notation.output-value");

/** A resource's output, usable as a value before it exists. Placed or interpolated, never computed with. */
export class OutputValue<T = unknown> {
  readonly [OUTPUT_VALUE] = true;
  /** Phantom: the output's type. */
  declare readonly __type: T;

  constructor(
    readonly resource: BaseResource,
    readonly path: string[],
  ) {}

  /** Turned into a string, it's a unique placeholder, so it can sit inside a template string. */
  toString(): string {
    return placeholderOf(this);
  }
}

export const isOutputValue = (value: unknown): value is OutputValue =>
  typeof value === "object" && value !== null && OUTPUT_VALUE in value;

/** A value that may hold output values in place of any part of it. */
export type WithOutputValues<T> =
  | OutputValue<T>
  | (T extends object ? { [K in keyof T]: WithOutputValues<T[K]> } : T);

/** `resource.out.<field>`: each output field as an output value. */
export type OutputValues<O> = { readonly [K in keyof O]-?: OutputValue<O[K]> };

export const outputValues = <O>(resource: BaseResource): OutputValues<O> =>
  new Proxy({} as OutputValues<O>, {
    get: (_, key) =>
      typeof key === "string" ? new OutputValue(resource, [key]) : undefined,
  });

const placeholders = new Map<string, OutputValue>();
const PLACEHOLDER = /⟦ov:(\d+)⟧/g;

const placeholderOf = (value: OutputValue) => {
  const placeholder = `⟦ov:${placeholders.size}⟧`;
  placeholders.set(placeholder, value);
  return placeholder;
};

/** The resources whose outputs `value` holds, whole or in template strings. */
export const outputSources = (value: unknown): BaseResource[] => {
  if (isOutputValue(value)) return [value.resource];
  if (typeof value === "string") {
    return [...value.matchAll(PLACEHOLDER)].map(
      ([p]) => placeholders.get(p)!.resource,
    );
  }
  if (Array.isArray(value)) return value.flatMap(outputSources);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(outputSources);
  }
  return [];
};

/**
 * `value` with its output values filled in from their resources' outputs. An
 * output not known yet is UNKNOWN_AFTER_APPLY at its own path: a whole value,
 * or a template string holding one.
 */
export const resolveOutputValues = (value: unknown): unknown => {
  if (isOutputValue(value)) return read(value);
  if (typeof value === "string" && PLACEHOLDER.test(value)) {
    PLACEHOLDER.lastIndex = 0;
    let unknown = false;
    const resolved = value.replace(PLACEHOLDER, (p) => {
      const part = read(placeholders.get(p)!);
      if (part === UNKNOWN_AFTER_APPLY) unknown = true;
      return String(part);
    });
    return unknown ? UNKNOWN_AFTER_APPLY : resolved;
  }
  if (Array.isArray(value)) return value.map(resolveOutputValues);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveOutputValues(v)]),
    );
  }
  return value;
};

const read = ({ resource, path }: OutputValue): unknown => {
  let value: unknown = resource.output;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return UNKNOWN_AFTER_APPLY;
    value = (value as Record<string, unknown>)[key];
  }
  return value === undefined ? UNKNOWN_AFTER_APPLY : value;
};

// ── Contributions ──

/** Who contributed: a `by` label, if library code gave one, and the call site. */
export type ContributionSource = { by: string; at: string };

export type Contribution = {
  values: Record<string, unknown>;
  source: ContributionSource;
};

/** How a collected param combines what's contributed to it. `from[i]` contributed `items[i]`. */
export type Collect<T> = (items: T[], from: ContributionSource[]) => T;

/** Anything that takes contributions to its collected params `P`. */
export type Contributable<P> = {
  contribute(
    values: Partial<WithOutputValues<P>>,
    options?: { by?: string },
  ): void;
};

export class ContributionConflictError extends Error {
  constructor(
    readonly key: string,
    readonly first: ContributionSource,
    readonly second: ContributionSource,
  ) {
    super(
      `"${key}" is contributed twice: by ${describe(first)} and by ${describe(second)}`,
    );
  }
}

export class LateContributionError extends Error {
  constructor(resourceId: string, at: string) {
    super(
      `${resourceId}: contributed to after infra was evaluated (${at}). Contribute while infra is being evaluated.`,
    );
  }
}

const describe = ({ by, at }: ContributionSource) =>
  by ? `${by} (${at})` : at;

/** Merges records key by key. A key contributed twice is a conflict, naming both contributors. */
export const mergeRecords = <V>(
  items: Record<string, V>[],
  from: ContributionSource[],
): Record<string, V> => {
  const merged: Record<string, V> = {};
  const owner: Record<string, ContributionSource> = {};
  items.forEach((item, i) => {
    for (const [key, value] of Object.entries(item ?? {})) {
      if (key in merged) {
        throw new ContributionConflictError(key, owner[key]!, from[i]!);
      }
      merged[key] = value;
      owner[key] = from[i]!;
    }
  });
  return merged;
};

/** Concatenates lists, in contribution order. */
export const concatLists = <V>(items: V[][]): V[] => items.flat();

/** The first stack frame outside Notation: the line that called `contribute`. */
export const callSite = (): string => {
  const frames = (new Error().stack ?? "").split("\n").slice(1);
  const caller = frames.find(
    (f) => !f.includes("/notation-resource/") && !f.includes("node:internal"),
  );
  return caller?.trim().replace(/^at\s+/, "") ?? "unknown";
};

/** Contributions in a stable order, so moving code never changes the result. */
export const ordered = (contributions: Contribution[]) =>
  [...contributions].sort(
    (a, b) =>
      a.source.by.localeCompare(b.source.by) ||
      a.source.at.localeCompare(b.source.at),
  );
