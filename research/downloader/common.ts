// research/downloader/common.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IndodaxPublicClient } from "@/market-data/indodax";
import { sha256 } from "@/strategy/hash";

export const ROOT = path.resolve(__dirname, "..", "..");
export const DATA_DIR = path.join(ROOT, "research", "data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const MANIFEST_DIR = path.join(ROOT, "research", "manifests");

export function researchClient(): IndodaxPublicClient {
  return new IndodaxPublicClient({ minIntervalMs: 350, maxAttempts: 4, timeoutMs: 20000 });
}

export function writeJson(file: string, value: unknown): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value, null, 1);
  writeFileSync(file, text);
  return sha256(text);
}

export function writeRaw(file: string, raw: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, raw);
  return sha256(raw);
}

export const STABLE_OR_PEGGED = new Set([
  "usdt", "usdc", "busd", "dai", "tusd", "usdp", "fdusd", "pyusd", "usde", "usdd", "idrt", "bidr", "eurt", "xaut", "paxg", "usd1",
]);
