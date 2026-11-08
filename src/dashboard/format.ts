// src/dashboard/format.ts

export function idr(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return `${v < 0 ? "-" : ""}Rp${Math.abs(v).toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return `${(v * 100).toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return v.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function qty(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return v.toLocaleString("id-ID", { maximumFractionDigits: 8 });
}

export function wib(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return "-";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  const d = new Date(t + 7 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} WIB`;
}

export function signClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "";
  return v > 0 ? "pos" : "neg";
}
