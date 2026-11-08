// src/strategy/hash.ts
import { createHash } from "node:crypto";
import { FROZEN_CONFIG, type FrozenConfig } from "./config";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function configHash(cfg: FrozenConfig = FROZEN_CONFIG): string {
  return sha256(stableStringify(cfg)).slice(0, 16);
}
