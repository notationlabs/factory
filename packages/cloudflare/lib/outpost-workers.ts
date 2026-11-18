import { cloudflare, cloudflareOrNone } from "./cloudflare-api.ts";

type Application = { id: string; name: string };

// Cloudflare refuses a container application's name with `--`, so the
// outpost config collapses dashes, and names are compared the same way.
const collapse = (name: string) => name.replace(/-{2,}/g, "-");

const applications = (token: string, accountId: string) =>
  cloudflare<Application[]>(token, "GET", `/accounts/${accountId}/containers/applications`);

const deleteApplication = (token: string, accountId: string, application: Application) =>
  cloudflareOrNone(token, "DELETE", `/accounts/${accountId}/containers/applications/${application.id}`);

/**
 * Deletes the outpost Worker `worker` and its container application.
 * Deleting a Worker leaves its container application in place.
 */
export const deleteOutpostWorker = async (token: string, accountId: string, worker: string) => {
  await cloudflareOrNone(token, "DELETE", `/accounts/${accountId}/workers/scripts/${worker}?force=true`);
  const name = collapse(worker);
  for (const application of await applications(token, accountId)) {
    if (application.name === name || application.name.startsWith(`${name}-`)) {
      await deleteApplication(token, accountId, application);
    }
  }
};

/** Deletes every outpost Worker whose name starts with `${prefix}-`, and every container application of one. */
export const deleteOutpostWorkers = async (token: string, accountId: string, prefix: string) => {
  const scripts = await cloudflare<{ id: string }[]>(token, "GET", `/accounts/${accountId}/workers/scripts`);
  for (const { id } of scripts) {
    if (id.startsWith(`${prefix}-`)) {
      await cloudflareOrNone(token, "DELETE", `/accounts/${accountId}/workers/scripts/${id}?force=true`);
    }
  }
  const start = `${collapse(prefix)}-`;
  for (const application of await applications(token, accountId)) {
    if (application.name.startsWith(start)) await deleteApplication(token, accountId, application);
  }
};
