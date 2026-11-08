-- migrations/001_init.sql
CREATE TABLE IF NOT EXISTS bot_config (
  id SERIAL PRIMARY KEY,
  config_version TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  config_hash TEXT NOT NULL UNIQUE,
  timeframe TEXT NOT NULL,
  universe_json JSONB NOT NULL,
  risk_config_json JSONB NOT NULL,
  config_json JSONB NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  frozen_commit_sha TEXT
);

CREATE TABLE IF NOT EXISTS bot_state (
  id INT PRIMARY KEY CHECK (id = 1),
  kill_switch BOOLEAN NOT NULL DEFAULT false,
  kill_switch_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_lock (
  id INT PRIMARY KEY CHECK (id = 1),
  holder TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tick_runs (
  id BIGSERIAL PRIMARY KEY,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  duration_ms INT,
  scheduler_source TEXT,
  error_code TEXT,
  error_message TEXT,
  processed_count INT NOT NULL DEFAULT 0,
  server_time TIMESTAMPTZ,
  request_count INT,
  retry_count INT,
  summary_json JSONB
);

CREATE TABLE IF NOT EXISTS raw_responses (
  id BIGSERIAL PRIMARY KEY,
  tick_id BIGINT,
  endpoint TEXT NOT NULL,
  url TEXT NOT NULL,
  status INT,
  attempts INT,
  received_at TIMESTAMPTZ NOT NULL,
  latency_ms INT,
  bytes INT,
  raw_hash TEXT,
  raw_text TEXT,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS pair_metadata (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL,
  pair TEXT NOT NULL,
  meta_json JSONB NOT NULL,
  meta_hash TEXT NOT NULL,
  UNIQUE (pair, meta_hash)
);

CREATE TABLE IF NOT EXISTS market_candles (
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  open_time BIGINT NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL,
  raw_hash TEXT,
  first_seen_tick BIGINT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pair, timeframe, open_time)
);

CREATE TABLE IF NOT EXISTS orderbook_snapshots (
  id BIGSERIAL PRIMARY KEY,
  tick_id BIGINT,
  pair TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  bids_json JSONB NOT NULL,
  asks_json JSONB NOT NULL,
  best_bid DOUBLE PRECISION,
  best_ask DOUBLE PRECISION,
  spread_bps DOUBLE PRECISION,
  levels_bid INT,
  levels_ask INT,
  raw_hash TEXT,
  valid BOOLEAN NOT NULL,
  invalid_reason TEXT
);
CREATE INDEX IF NOT EXISTS orderbook_pair_time ON orderbook_snapshots (pair, captured_at);

CREATE TABLE IF NOT EXISTS signals (
  id BIGSERIAL PRIMARY KEY,
  tick_id BIGINT,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  candle_open_time BIGINT NOT NULL,
  side TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  feature_json JSONB NOT NULL,
  strategy_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair, timeframe, candle_open_time, strategy_version)
);

CREATE TABLE IF NOT EXISTS sim_orders (
  id BIGSERIAL PRIMARY KEY,
  tick_id BIGINT,
  signal_id BIGINT,
  pair TEXT NOT NULL,
  side TEXT NOT NULL,
  status TEXT NOT NULL,
  reject_reason TEXT,
  requested_qty DOUBLE PRECISION,
  requested_notional DOUBLE PRECISION,
  filled_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_fill DOUBLE PRECISION,
  notional DOUBLE PRECISION NOT NULL DEFAULT 0,
  fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  fee_rate DOUBLE PRECISION,
  bid_at_decision DOUBLE PRECISION,
  ask_at_decision DOUBLE PRECISION,
  mid_at_decision DOUBLE PRECISION,
  signal_price DOUBLE PRECISION,
  spread_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  slippage_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sim_fills (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL,
  level_index INT NOT NULL,
  book_side TEXT NOT NULL,
  level_price DOUBLE PRECISION NOT NULL,
  level_qty DOUBLE PRECISION NOT NULL,
  filled_qty DOUBLE PRECISION NOT NULL,
  fee_component DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id BIGSERIAL PRIMARY KEY,
  pair TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL,
  avg_entry_cost DOUBLE PRECISION NOT NULL,
  cost_basis DOUBLE PRECISION NOT NULL,
  entry_spread_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  entry_slippage_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  entry_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL,
  entry_order_id BIGINT,
  entry_candle_open_time BIGINT NOT NULL,
  highest_close DOUBLE PRECISION NOT NULL,
  last_candle_open_time BIGINT NOT NULL,
  strategy_version TEXT NOT NULL,
  status TEXT NOT NULL,
  closed_at TIMESTAMPTZ,
  exit_order_id BIGINT,
  exit_reason TEXT,
  realized_pnl DOUBLE PRECISION
);
CREATE UNIQUE INDEX IF NOT EXISTS positions_one_open_per_pair ON positions (pair) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS ledger_events (
  id BIGSERIAL PRIMARY KEY,
  tick_id BIGINT,
  event_time TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  reference_type TEXT,
  reference_id BIGINT,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS equity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  tick_id BIGINT,
  captured_at TIMESTAMPTZ NOT NULL,
  local_trading_date TEXT NOT NULL,
  phase TEXT NOT NULL,
  cash DOUBLE PRECISION NOT NULL,
  inventory_value_at_bid DOUBLE PRECISION NOT NULL,
  equity DOUBLE PRECISION NOT NULL,
  realized_pnl DOUBLE PRECISION NOT NULL,
  unrealized_pnl DOUBLE PRECISION NOT NULL,
  is_day_start BOOLEAN NOT NULL DEFAULT false,
  stale_marks INT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS equity_one_day_start ON equity_snapshots (local_trading_date) WHERE is_day_start;

CREATE TABLE IF NOT EXISTS risk_events (
  id BIGSERIAL PRIMARY KEY,
  tick_id BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL,
  rule TEXT NOT NULL,
  state TEXT NOT NULL,
  threshold DOUBLE PRECISION,
  observed_value DOUBLE PRECISION,
  action TEXT NOT NULL,
  pair TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS system_events (
  id BIGSERIAL PRIMARY KEY,
  tick_id BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL,
  severity TEXT NOT NULL,
  component TEXT NOT NULL,
  event_code TEXT NOT NULL,
  sanitized_payload JSONB
);
