// scripts/migrate.js
// Run this once locally (after `npm install`) to apply the schema to your
// Vercel Postgres instance:
//
//   POSTGRES_URL=... node scripts/migrate.js
//
// Or run from Vercel CLI:
//   vercel env pull .env.local
//   node scripts/migrate.js
//
// The migration is idempotent — safe to run multiple times.

import { sql } from "@vercel/postgres";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  for (const file of files) {
    console.log(`Applying ${file}...`);
    const content = await fs.readFile(path.join(migrationsDir, file), "utf-8");
    // Each migration may have multiple statements; execute as a single block.
    await sql.query(content);
    console.log(`  ${file} applied.`);
  }
  console.log("All migrations applied.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
