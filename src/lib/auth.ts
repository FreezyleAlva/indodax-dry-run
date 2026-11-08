// src/lib/auth.ts
import { timingSafeEqual } from "node:crypto";

export function bearerOk(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
