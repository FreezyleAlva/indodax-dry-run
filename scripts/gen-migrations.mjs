// scripts/gen-migrations.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "migrations");
const list = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => ({ version: f, sql: readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n") }));
const out = `// src/persistence/migrations.generated.ts\n\nexport const MIGRATIONS: { version: string; sql: string }[] = ${JSON.stringify(list, null, 2)};\n`;
writeFileSync(path.join(root, "src", "persistence", "migrations.generated.ts"), out);
console.log(`migrations.generated.ts: ${list.map((m) => m.version).join(", ")}`);
