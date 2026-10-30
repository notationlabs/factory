import { isOutputValue, type OutputValue } from "@notation/resource";

/**
 * Where a secret's value comes from when its vault item is created. It's part
 * of the item's identity, not its value: the provider holds the value, and a
 * vault never reads it back.
 */
export type Secret =
  | { kind: "env"; name: string }
  | { kind: "generated"; bytes: number }
  | { kind: "prompt"; label: string }
  | { kind: "output"; value: OutputValue<string> };

export const secret = {
  /** Read from the environment of whoever runs the deploy, e.g. `CLAUDE_CODE_OAUTH_TOKEN`. */
  env: (name: string): Secret => ({ kind: "env", name }),
  /** Random, generated once when it's created, e.g. the root key. */
  generated: (bytes = 32): Secret => ({ kind: "generated", bytes }),
  /** Pasted, unechoed, by whoever runs the deploy, e.g. a Slack bot token. */
  prompt: (label: string): Secret => ({ kind: "prompt", label }),
  /** Another resource's output, e.g. a GitHub App's private key. */
  output: (value: OutputValue<string>): Secret => ({ kind: "output", value }),
};

export const isSecret = (value: unknown): value is Secret => {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  switch (s.kind) {
    case "env":
      return typeof s.name === "string";
    case "generated":
      return typeof s.bytes === "number";
    case "prompt":
      return typeof s.label === "string";
    case "output":
      return isOutputValue(s.value);
    default:
      return false;
  }
};
