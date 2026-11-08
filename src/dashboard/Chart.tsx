// src/dashboard/Chart.tsx
import type { EquityPoint } from "@/domain/types";
import { idr, wib } from "./format";

export type Series = { name: string; color: string; points: EquityPoint[]; dashed?: boolean };

export function LineChart({ series, height = 240, title }: { series: Series[]; height?: number; title: string }) {
  const W = 960;
  const H = height;
  const pad = { l: 96, r: 16, t: 12, b: 28 };
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    return (
      <div className="chart">
        <h3>{title}</h3>
        <p className="muted">Belum cukup titik data.</p>
      </div>
    );
  }
  const t0 = Math.min(...all.map((p) => p.time));
  const t1 = Math.max(...all.map((p) => p.time));
  let y0 = Math.min(...all.map((p) => p.equity));
  let y1 = Math.max(...all.map((p) => p.equity));
  if (y1 - y0 < 1) { y0 -= 1; y1 += 1; }
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => y0 + f * (y1 - y0));
  return (
    <div className="chart">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#1A2940" strokeWidth="1" />
            <text x={pad.l - 8} y={y(v) + 4} fill="#7F8DA3" fontSize="11" textAnchor="end">{idr(v)}</text>
          </g>
        ))}
        <text x={pad.l} y={H - 8} fill="#7F8DA3" fontSize="11">{wib(t0)}</text>
        <text x={W - pad.r} y={H - 8} fill="#7F8DA3" fontSize="11" textAnchor="end">{wib(t1)}</text>
        {series.map((s) =>
          s.points.length > 1 ? (
            <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "6 4" : undefined} points={s.points.map((p) => `${x(p.time).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ")} />
          ) : null,
        )}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <span className="sw" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
