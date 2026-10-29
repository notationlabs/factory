/** The Access API calls operator auth makes. Stubs: achq's plugin-cloudflare has the real ones. */

export const createApplication = async (_params: {
  name: string;
  domain: string;
  emails: string[];
}): Promise<{ id: string }> => {
  throw new Error(
    "not implemented: create an Access application, with a policy allowing `emails`",
  );
};

export const getApplication = async (_key: {
  id: string;
}): Promise<{ id: string; aud: string }> => {
  throw new Error(
    "not implemented: read an Access application and its audience tag",
  );
};

export const updateApplication = async (
  _key: { id: string },
  _params: { domain: string; emails: string[] },
): Promise<void> => {
  throw new Error(
    "not implemented: update an Access application and its policy",
  );
};

export const deleteApplication = async (_key: {
  id: string;
}): Promise<void> => {
  throw new Error("not implemented: delete an Access application");
};
