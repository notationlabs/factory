/**
 * Makes a binding name from a secret's id, such as `GH_PRIVATE_KEY` from
 * `gh-private-key`. A binding name is a JavaScript identifier, so each
 * character other than a letter, a digit or `_` becomes `_`.
 */
export const bindingName = (id: string): string => {
  const name = id.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return /^[0-9]/.test(name) ? `_${name}` : name;
};
