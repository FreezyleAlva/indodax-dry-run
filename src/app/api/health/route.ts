// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/persistence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const r = await db.query<{ status: string; started_at: string; finished_at: string | null }>("SELECT status, started_at, finished_at FROM tick_runs ORDER BY id DESC LIMIT 1");
    const last = r.rows[0] ?? null;
    return NextResponse.json({ ok: true, lastTick: last ? { status: last.status, startedAt: last.started_at, finishedAt: last.finished_at } : null });
  } catch {
    return NextResponse.json({ ok: false, error: "DB_UNAVAILABLE" }, { status: 503 });
  }
}
