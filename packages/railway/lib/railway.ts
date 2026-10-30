import type { Secret } from "lightbox";

/** The Railway API calls the hub's resources make. Stubs: achq's plugin-railway has the real ones. */

export const createProject = async (_params: {
  name: string;
}): Promise<{ id: string }> => {
  throw new Error("not implemented: create a Railway project");
};

export const getProject = async (_key: {
  id: string;
}): Promise<{ id: string; name: string }> => {
  throw new Error("not implemented: read a Railway project");
};

export const deleteProject = async (_key: { id: string }): Promise<void> => {
  throw new Error("not implemented: delete a Railway project");
};

export type ServiceParams = {
  projectId: string;
  name: string;
  public?: boolean;
  volume?: string;
  sleep?: boolean;
  vars?: Record<string, unknown>;
};

export const createService = async (
  _params: ServiceParams,
): Promise<{ id: string }> => {
  throw new Error(
    "not implemented: create a service, with its volume, domain and variables",
  );
};

export const getService = async (_key: {
  id: string;
}): Promise<{ id: string; url: string }> => {
  throw new Error("not implemented: read a service and its URL");
};

export const updateService = async (
  _key: { id: string },
  _params: ServiceParams,
): Promise<void> => {
  throw new Error("not implemented: update a service and redeploy it");
};

export const deleteService = async (_key: { id: string }): Promise<void> => {
  throw new Error("not implemented: delete a service");
};

export const putSealedVariable = async (
  _key: { projectId: string; name: string },
  _source: Secret,
): Promise<void> => {
  throw new Error(
    "not implemented: resolve the secret's value from its source and write it as a sealed shared variable",
  );
};

export const getSealedVariable = async (_key: {
  projectId: string;
  name: string;
}): Promise<{}> => {
  throw new Error(
    "not implemented: check a sealed variable exists, or throw ResourceNotFoundError",
  );
};

export const deleteSealedVariable = async (_key: {
  projectId: string;
  name: string;
}): Promise<void> => {
  throw new Error("not implemented: delete a sealed variable");
};

export const writeRouterConfig = async (
  _key: { serviceId: string; path: string },
  _config: unknown,
): Promise<void> => {
  throw new Error(
    "not implemented: write the router's config to its /data volume, through its admin API",
  );
};

export const readRouterConfig = async (_key: {
  serviceId: string;
  path: string;
}): Promise<unknown> => {
  throw new Error("not implemented: read the router's config");
};

export const deleteRouterConfig = async (_key: {
  serviceId: string;
  path: string;
}): Promise<void> => {
  throw new Error("not implemented: delete the router's config");
};
