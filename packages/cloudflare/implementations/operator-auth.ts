import { ResourceGroup } from "@notation/resource";
import {
  type OperatorAuth as OperatorAuthContract,
  scopedName,
} from "@notation/factory";
import * as v from "valibot";
import {
  AccessApplication,
  type AccessApplicationInstance,
} from "../resources/access.ts";
import type { Router } from "./router.ts";

const operatorAuthConfig = v.object({ emails: v.array(v.string()) });
export type OperatorAuthConfig = v.InferInput<typeof operatorAuthConfig>;

export type OperatorAuthOptions = OperatorAuthConfig & { router: Router };

/** Operators sign in to Cloudflare Access, which decides who gets in. The router verifies Access's token before it returns an admin session. */
export class OperatorAuth
  extends ResourceGroup<OperatorAuthConfig>
  implements OperatorAuthContract
{
  readonly provider = "cloudflare";
  readonly application: AccessApplicationInstance;

  constructor(id: string, { router, ...config }: OperatorAuthOptions) {
    const { emails } = v.parse(operatorAuthConfig, config);
    super("cloudflare/OperatorAuth", id, config);
    this.application = this.add(
      new AccessApplication(`${id}-access`, {
        config: {
          AccountId: router.kv.outputRef("AccountId"),
          Name: scopedName(id, 255),
          Domain: router.url.map((url) => `${new URL(url).host}/admin`),
          Emails: emails,
        },
      }),
    );
    router.store.contribute({
      operators: {
        provider: "cloudflare",
        aud: this.application.outputRef("Aud"),
        emails,
      },
    });
  }
}
