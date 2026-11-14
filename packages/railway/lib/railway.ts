import type { Redacted } from "@notation/std/sources";

export const createProject = async (_params: {
  name: string;
}): Promise<{ id: string; environmentId: string }> => {
  throw new Error("not implemented: create a Railway project");
};

export const getProject = async (_key: {
  id: string;
}): Promise<{ id: string; name: string; environmentId: string }> => {
  throw new Error("not implemented: read a Railway project");
};

export const deleteProject = async (_key: { id: string }): Promise<void> => {
  throw new Error("not implemented: delete a Railway project");
};

export const createProjectToken = async (_params: {
  projectId: string;
  environmentId: string;
  name: string;
}): Promise<{ id: string; value: string }> => {
  throw new Error("not implemented: create a Railway project token");
};

export const getProjectToken = async (_key: {
  id: string;
}): Promise<{ id: string; value: string }> => {
  throw new Error("not implemented: read a Railway project token");
};

export const deleteProjectToken = async (_key: {
  id: string;
}): Promise<void> => {
  throw new Error("not implemented: delete a Railway project token");
};

export type ServiceParams = {
  projectId: string;
  name: string;
  public?: boolean;
  volume?: string;
  sleep?: boolean;
  vars?: Record<string, string>;
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

export type SealedVariableKey = {
  projectId: string;
  environmentId: string;
  name: string;
};

export const findProject = async (_query: {
  name: string;
}): Promise<{ id: string; environmentId: string } | undefined> => {
  throw new Error("not implemented: find a Railway project by name");
};

export const putSealedVariable = async (
  _key: SealedVariableKey,
  _value: Redacted<string> | string,
): Promise<void> => {
  throw new Error(
    "not implemented: write the value as a shared variable, and seal it",
  );
};

export const findSealedVariable = async (
  _key: SealedVariableKey,
): Promise<{ name: string } | undefined> => {
  throw new Error("not implemented: find a sealed shared variable by name");
};

export const deleteSealedVariable = async (
  _key: SealedVariableKey,
): Promise<void> => {
  throw new Error("not implemented: delete a sealed shared variable");
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
