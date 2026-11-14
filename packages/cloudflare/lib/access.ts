/** The Access API calls operator auth makes. Stubs. */

export type ApplicationKey = { AccountId: string; ApplicationId: string };

export const createApplication = async (_params: {
  AccountId: string;
  Name: string;
  Domain: string;
  Emails: string[];
}): Promise<{ ApplicationId: string }> => {
  throw new Error(
    "not implemented: create an Access application, with a policy allowing `Emails`",
  );
};

export const getApplication = async (
  _key: ApplicationKey,
): Promise<{ Aud: string }> => {
  throw new Error(
    "not implemented: read an Access application and its audience tag",
  );
};

export const updateApplication = async (
  _key: ApplicationKey,
  _params: { Domain: string; Emails: string[] },
): Promise<void> => {
  throw new Error(
    "not implemented: update an Access application and its policy",
  );
};

export const deleteApplication = async (
  _key: ApplicationKey,
): Promise<void> => {
  throw new Error("not implemented: delete an Access application");
};
