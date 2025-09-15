export function getRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`${name} environment variable is required`);
}
