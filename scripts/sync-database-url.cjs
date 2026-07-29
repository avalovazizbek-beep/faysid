// Rebuilds DATABASE_URL in .env from the separate DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME
// fields, URL-encoding user/password so special characters (e.g. "@") never break the
// connection string. Runs automatically before dev/build/prisma:* via npm's "pre<script>" hook.
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, "..", ".env");

if (!fs.existsSync(envPath)) {
  console.warn(".env not found — skipping DATABASE_URL sync (copy .env.example to .env first)");
  process.exit(0);
}

const lines = fs.readFileSync(envPath, "utf8").split("\n");

function readValue(key) {
  const line = lines.find((entry) => entry.startsWith(`${key}=`));
  if (!line) return undefined;
  return line.slice(key.length + 1).trim().replace(/^"(.*)"$/, "$1");
}

const host = readValue("DB_HOST");
const port = readValue("DB_PORT");
const user = readValue("DB_USER");
const password = readValue("DB_PASSWORD") ?? "";
const name = readValue("DB_NAME");

if (!host || !port || !user || !name) {
  console.warn("DB_HOST/DB_PORT/DB_USER/DB_NAME not fully set in .env — skipping DATABASE_URL sync");
  process.exit(0);
}

const databaseUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
const newLine = `DATABASE_URL="${databaseUrl}"`;

const existingIndex = lines.findIndex((entry) => entry.startsWith("DATABASE_URL="));
if (existingIndex >= 0) {
  if (lines[existingIndex] === newLine) process.exit(0);
  lines[existingIndex] = newLine;
} else {
  lines.push(newLine);
}

fs.writeFileSync(envPath, lines.join("\n"));
console.log(`DATABASE_URL synced from DB_* vars (${user}@${host}:${port}/${name})`);
