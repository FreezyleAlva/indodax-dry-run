// scripts/migrate.ts
import { ensureSchema, getDb } from "@/persistence/db";
import { bootstrap } from "@/services/tick";

async function main() {
  const db = await getDb();
  const ran = await ensureSchema(db);
  await bootstrap(db);
  console.log(`migrasi: ${ran.length ? ran.join(", ") : "tidak ada yang baru"} (${db.kind})`);
  await db.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
