import dotenv from "dotenv";

let envLoaded = false;

function ensureEnvLoaded() {
  if (envLoaded) return;
  envLoaded = true;
  dotenv.config();
}

export function getRequiredEnv(name) {
  ensureEnvLoaded();
  const value = process.env[name];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`${name} environment variable is required`);
}
