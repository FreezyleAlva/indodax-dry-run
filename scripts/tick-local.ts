// scripts/tick-local.ts
import { getDb } from "@/persistence/db";
import { runTick } from "@/services/tick";

async function main() {
  const db = await getDb();
  const summary = await runTick({ db }, { source: "local-cli", scheduledAt: new Date().toISOString() });
  console.log(JSON.stringify(summary, null, 1));
  await db.close();
  if (summary.status === "FAILED") process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
