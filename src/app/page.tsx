// src/app/page.tsx
import { buildReport } from "@/analytics/report";
import { Dashboard, type BacktestSummary } from "@/dashboard/Dashboard";
import { DASHBOARD_CSS } from "@/dashboard/styles";
import { FREEZE_NOTE } from "@/lib/freeze";
import { getDb } from "@/persistence/db";
import { loadRawExport } from "@/persistence/export";
import { bootstrap } from "@/services/tick";
import backtest from "../../research/output/backtest-summary.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page() {
  let body;
  try {
    const db = await getDb();
    await bootstrap(db);
    const raw = await loadRawExport(db);
    const report = buildReport(raw);
    body = <Dashboard report={report} backtest={backtest as unknown as BacktestSummary} meta={{ mode: "online", commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, generatedAt: raw.exportedAt, freezeNote: FREEZE_NOTE }} />;
  } catch (e) {
    const code = e instanceof Error ? e.message.split(":")[0]!.slice(0, 60) : "UNKNOWN";
    body = (
      <div className="wrap">
        <h1>Dashboard belum bisa membaca database</h1>
        <p className="muted">Kode error: {code}. Data tidak ditampilkan daripada menampilkan angka yang tidak berasal dari log.</p>
      </div>
    );
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DASHBOARD_CSS }} />
      {body}
    </>
  );
}
