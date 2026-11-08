// src/dashboard/offline-verify.ts
import { buildReport, type RawExport, type Report } from "@/analytics/report";

function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

function run() {
  const box = document.getElementById("verify");
  const rawEl = document.getElementById("raw-export");
  const repEl = document.getElementById("report");
  if (!box || !rawEl || !repEl) return;
  try {
    const raw = JSON.parse(rawEl.textContent ?? "{}") as RawExport;
    const shown = JSON.parse(repEl.textContent ?? "{}") as Report;
    const again = buildReport(raw);
    const same = stable(again) === stable(shown);
    box.className = `verify ${same ? "ok" : "bad"}`;
    box.textContent = same
      ? `Hitung ulang di browser dari log mentah yang disertakan: COCOK. ${raw.signals.length} sinyal, ${raw.orders.length} order, ${raw.equity.length} snapshot ekuitas, ${raw.tickRuns.length} tick.`
      : "Hitung ulang di browser TIDAK COCOK dengan angka yang ditampilkan. Jangan pakai dashboard ini sebelum diselidiki.";
  } catch (e) {
    box.className = "verify bad";
    box.textContent = `Verifikasi gagal: ${(e as Error).message}`;
  }
}

run();
