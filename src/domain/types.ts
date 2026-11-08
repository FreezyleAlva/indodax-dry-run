// src/domain/types.ts

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Side = "BUY" | "SELL" | "HOLD";

export type FlatPosition = { open: false };

export type OpenPosition = {
  open: true;
  qty: number;
  avgEntryCost: number;
  entryTime: number;
  highestClose: number;
  lastCandleOpenTime: number;
};

export type PositionState = FlatPosition | OpenPosition;

export type FeatureValue = number | boolean | null;

export type Signal = {
  pair: string;
  candleOpenTime: number;
  side: Side;
  reasonCode: string;
  features: Record<string, FeatureValue>;
  strategyVersion: string;
  configHash: string;
};

export type BookLevel = { price: number; qty: number };

export type OrderBook = {
  pair: string;
  capturedAt: number;
  bids: BookLevel[];
  asks: BookLevel[];
};

export type PairMeta = {
  pair: string;
  symbol: string;
  tickerId: string;
  priceIncrement: number;
  quantityIncrement: number;
  minBaseIdr: number;
  minTraded: number;
  takerFee: number;
  maintenance: boolean;
  suspended: boolean;
};

export type FillLevel = {
  levelIndex: number;
  price: number;
  levelQty: number;
  filledQty: number;
};

export type FillResult = {
  side: "BUY" | "SELL";
  status: "FILLED" | "PARTIAL" | "REJECTED";
  rejectReason: string | null;
  requestedQty: number;
  requestedNotional: number;
  filledQty: number;
  avgPrice: number;
  notional: number;
  fee: number;
  levels: FillLevel[];
  bestBid: number;
  bestAsk: number;
  mid: number;
  spreadCost: number;
  slippageCost: number;
};

export type EquityPoint = { time: number; equity: number };

export type ClosedTrade = {
  pair: string;
  entryTime: number;
  exitTime: number;
  qty: number;
  entryNotional: number;
  exitNotional: number;
  fees: number;
  spreadCost: number;
  slippageCost: number;
  pnl: number;
  exitReason: string;
};
