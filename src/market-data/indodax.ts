// src/market-data/indodax.ts
import type { BookLevel, Candle, OrderBook, PairMeta } from "@/domain/types";

export type FetchResult<T> = {
  data: T;
  raw: string;
  status: number;
  attempts: number;
  url: string;
  receivedAt: number;
  latencyMs: number;
};

export class MarketDataError extends Error {
  constructor(public code: string, message: string, public attempts: number, public status: number | null) {
    super(message);
  }
}

export type ClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (info: { url: string; attempt: number; status: number | null; error: string | null }) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class IndodaxPublicClient {
  private baseUrl: string;
  private timeoutMs: number;
  private maxAttempts: number;
  private minIntervalMs: number;
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private lastRequestAt = 0;
  public requestCount = 0;
  public retryCount = 0;

  constructor(private opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://indodax.com").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.minIntervalMs = opts.minIntervalMs ?? 0;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async getJson<T>(path: string): Promise<FetchResult<T>> {
    const url = `${this.baseUrl}${path}`;
    let lastErr: MarketDataError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (this.minIntervalMs > 0) {
        const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
        if (wait > 0) await this.sleep(wait);
      }
      this.lastRequestAt = Date.now();
      this.requestCount++;
      if (attempt > 1) this.retryCount++;
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let status: number | null = null;
      try {
        const res = await this.fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json", "user-agent": "indodax-dry-run-uas/1.0" }, cache: "no-store" });
        status = res.status;
        const raw = await res.text();
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new MarketDataError(res.status === 429 ? "RATE_LIMITED" : "HTTP_5XX", `HTTP ${res.status}`, attempt, res.status);
          this.opts.onAttempt?.({ url, attempt, status, error: lastErr.code });
        } else if (res.status >= 400) {
          throw new MarketDataError("HTTP_4XX", `HTTP ${res.status}`, attempt, res.status);
        } else {
          let data: T;
          try {
            data = JSON.parse(raw) as T;
          } catch {
            throw new MarketDataError("MALFORMED_JSON", "respons bukan JSON", attempt, res.status);
          }
          this.opts.onAttempt?.({ url, attempt, status, error: null });
          return { data, raw, status: res.status, attempts: attempt, url, receivedAt: Date.now(), latencyMs: Date.now() - started };
        }
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof MarketDataError && (e.code === "HTTP_4XX" || e.code === "MALFORMED_JSON")) throw e;
        const aborted = e instanceof Error && e.name === "AbortError";
        lastErr = e instanceof MarketDataError ? e : new MarketDataError(aborted ? "TIMEOUT" : "NETWORK", aborted ? "timeout" : String((e as Error).message ?? e), attempt, status);
        this.opts.onAttempt?.({ url, attempt, status, error: lastErr.code });
      }
      if (attempt < this.maxAttempts) {
        const backoff = Math.min(4000, 300 * 2 ** (attempt - 1));
        await this.sleep(backoff + Math.floor(Math.random() * 250));
      }
    }
    throw lastErr ?? new MarketDataError("UNKNOWN", "gagal tanpa sebab", this.maxAttempts, null);
  }

  async serverTime(): Promise<FetchResult<number>> {
    const r = await this.getJson<{ server_time: number }>("/api/server_time");
    const t = Number(r.data?.server_time);
    if (!Number.isFinite(t) || t <= 0) throw new MarketDataError("BAD_SERVER_TIME", "server_time tidak valid", r.attempts, r.status);
    return { ...r, data: t };
  }

  async pairs(): Promise<FetchResult<PairMeta[]>> {
    const [p, inc] = [await this.getJson<RawPair[]>("/api/pairs"), await this.getJson<{ increments: Record<string, string> }>("/api/price_increments")];
    if (!Array.isArray(p.data)) throw new MarketDataError("BAD_PAIRS", "pairs bukan array", p.attempts, p.status);
    const increments = inc.data?.increments ?? {};
    const metas = p.data.map((x) => normalizePair(x, increments));
    return { ...p, raw: JSON.stringify({ pairs: p.raw.length, increments: inc.raw.length }), data: metas };
  }

  async candles(symbol: string, tf: string, fromSec: number, toSec: number): Promise<FetchResult<Candle[]>> {
    const r = await this.getJson<RawCandle[]>(`/tradingview/history_v2?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&from=${Math.floor(fromSec)}&to=${Math.floor(toSec)}`);
    if (!Array.isArray(r.data)) throw new MarketDataError("BAD_CANDLES", "history bukan array", r.attempts, r.status);
    return { ...r, data: normalizeCandles(r.data) };
  }

  async depth(pair: string): Promise<FetchResult<OrderBook>> {
    const r = await this.getJson<{ buy?: [string, string][]; sell?: [string, string][] }>(`/api/depth/${encodeURIComponent(pair)}`);
    return { ...r, data: { pair, capturedAt: r.receivedAt, bids: levels(r.data?.buy), asks: levels(r.data?.sell) } };
  }
}

type RawPair = {
  id: string;
  symbol: string;
  ticker_id: string;
  trade_min_base_currency: number | string;
  trade_min_traded_currency: number | string;
  trade_fee_percent_taker: number | string;
  quantity_increment?: number | string;
  is_maintenance?: number;
  is_market_suspended?: number;
};

type RawCandle = { Time: number | string; Open: number | string; High: number | string; Low: number | string; Close: number | string; Volume: number | string };

export function normalizePair(x: RawPair, increments: Record<string, string>): PairMeta {
  return {
    pair: String(x.id),
    symbol: String(x.symbol),
    tickerId: String(x.ticker_id),
    priceIncrement: Number(increments[x.ticker_id] ?? NaN),
    quantityIncrement: Number(x.quantity_increment ?? 1e-8),
    minBaseIdr: Number(x.trade_min_base_currency),
    minTraded: Number(x.trade_min_traded_currency),
    takerFee: Number(x.trade_fee_percent_taker) / 100,
    maintenance: Number(x.is_maintenance ?? 0) === 1,
    suspended: Number(x.is_market_suspended ?? 0) === 1,
  };
}

export function normalizeCandles(rows: readonly RawCandle[]): Candle[] {
  const out = rows.map((r) => ({
    openTime: Number(r.Time),
    open: Number(r.Open),
    high: Number(r.High),
    low: Number(r.Low),
    close: Number(r.Close),
    volume: Number(r.Volume),
  }));
  out.sort((a, b) => a.openTime - b.openTime);
  const dedup: Candle[] = [];
  for (const c of out) {
    if (dedup.length > 0 && dedup[dedup.length - 1]!.openTime === c.openTime) dedup[dedup.length - 1] = c;
    else dedup.push(c);
  }
  return dedup;
}

function levels(rows: [string, string][] | undefined): BookLevel[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(([p, q]) => ({ price: Number(p), qty: Number(q) }));
}

export function pairSymbol(pair: string): string {
  return pair.toUpperCase();
}
