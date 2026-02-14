import fs from "node:fs";
import path from "node:path";

const environments = ["dev", "stage", "prod"];
let hasError = false;
const parsedByEnv = new Map();

function parseEnv(fileContents) {
  const entries = new Map();
  const lines = fileContents.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1);
    entries.set(key, value);
  }

  return entries;
}

for (const environment of environments) {
  const filePath = path.join(process.cwd(), "env", `${environment}.env.example`);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    hasError = true;
    continue;
  }

  const data = fs.readFileSync(filePath, "utf8");
  const parsed = parseEnv(data);
  parsedByEnv.set(environment, parsed);

  const appEnv = parsed.get("APP_ENV");
  if (appEnv !== environment) {
    console.error(`APP_ENV must be ${environment} in env/${environment}.env.example`);
    hasError = true;
  }
}

const baseline = parsedByEnv.get("dev");
if (baseline) {
  const baselineKeys = [...baseline.keys()];

  for (const environment of environments) {
    const parsed = parsedByEnv.get(environment);
    if (!parsed) {
      continue;
    }

    for (const key of baselineKeys) {
      if (!parsed.has(key)) {
        console.error(`Missing key ${key} in env/${environment}.env.example`);
        hasError = true;
      }
    }

    for (const key of parsed.keys()) {
      if (!baseline.has(key)) {
        console.error(`Unexpected key ${key} in env/${environment}.env.example`);
        hasError = true;
      }
    }
  }
}

if (hasError) {
  process.exit(1);
}

console.log("Environment templates validated.");
