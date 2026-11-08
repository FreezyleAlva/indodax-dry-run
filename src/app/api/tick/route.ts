// src/app/api/tick/route.ts
import { NextResponse } from "next/server";
import { bearerOk } from "@/lib/auth";
import { getDb } from "@/persistence/db";
import { runTick } from "@/services/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request, source: string, scheduledAt: string | null) {
  if (!bearerOk(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const db = await getDb();
    const summary = await runTick({ db }, { source, scheduledAt });
    const status = summary.status === "FAILED" ? 502 : 200;
    return NextResponse.json({ ok: summary.status !== "FAILED", summary }, { status });
  } catch (e) {
    const code = e instanceof Error ? e.message.split(":")[0]!.slice(0, 60) : "UNKNOWN";
    return NextResponse.json({ ok: false, error: code }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { source?: unknown; scheduledAt?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const source = typeof body.source === "string" && /^[a-z0-9:_-]{1,40}$/i.test(body.source) ? body.source : "manual";
  const scheduledAt = typeof body.scheduledAt === "string" && !Number.isNaN(Date.parse(body.scheduledAt)) ? new Date(body.scheduledAt).toISOString() : null;
  return handle(req, source, scheduledAt);
}

export async function GET(req: Request) {
  const ua = req.headers.get("user-agent") ?? "";
  return handle(req, ua.includes("vercel-cron") ? "vercel-cron" : "get", null);
}
