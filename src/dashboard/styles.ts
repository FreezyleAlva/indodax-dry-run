// src/dashboard/styles.ts

export const DASHBOARD_CSS = `
:root{--s0:#0A111C;--s1:#0F1826;--s2:#142033;--s3:#1A2940;--s4:#22344F;--i1:#E2E9F2;--i2:#A9B6C8;--i3:#7F8DA3;--i4:#4D5C73;--b2:#4A7BC0;--c2:#48A1B1;--pos:#48A1B1;--neg:#C47C74;--warn:#C2A36B;--grid:#1A2940;--r-sm:6px;--r-md:10px;--r-lg:14px}
*{box-sizing:border-box}
html,body{margin:0;background:var(--s0);color:var(--i1);font-family:Inter,"Segoe UI",system-ui,sans-serif;font-size:14px;line-height:1.5}
.wrap{max-width:1280px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:28px;margin:0 0 4px;font-weight:600}
h2{font-size:20px;margin:0 0 12px;font-weight:600}
h3{font-size:14px;margin:0 0 8px;font-weight:600;color:var(--i2)}
p{margin:0 0 8px}
.muted{color:var(--i3)}
.mono{font-family:"JetBrains Mono",Consolas,ui-monospace,monospace;font-size:12px}
.head{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:flex-end;margin-bottom:24px}
.tags{display:flex;flex-wrap:wrap;gap:8px}
.tag{background:var(--s2);color:var(--i2);border-radius:var(--r-sm);padding:4px 8px;font-size:12px}
.notice{background:var(--s2);border-radius:var(--r-md);padding:12px 16px;margin-bottom:24px;color:var(--i2)}
.notice b{color:var(--warn)}
.panel{background:var(--s1);border-radius:var(--r-lg);padding:24px;margin-bottom:16px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.kpi{background:var(--s2);border-radius:var(--r-md);padding:12px 16px}
.kpi .l{font-size:12px;color:var(--i3)}
.kpi .v{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.kpi .s{font-size:12px;color:var(--i3)}
.two{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.pos{color:var(--pos)}
.neg{color:var(--neg)}
.warn{color:var(--warn)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{font-size:12px;color:var(--i3);text-align:left;font-weight:500;padding:8px;border-bottom:1px solid var(--s3)}
td{padding:8px;border-bottom:1px solid var(--s2);vertical-align:top}
td.r,th.r{text-align:right}
.scroll{overflow-x:auto;max-height:420px;overflow-y:auto}
.chart{background:var(--s2);border-radius:var(--r-md);padding:12px}
.legend{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--i2);margin-top:8px}
.sw{display:inline-block;width:12px;height:4px;border-radius:2px;margin-right:6px;vertical-align:middle}
.ok{color:var(--pos)}
.bad{color:var(--neg)}
.verify{background:var(--s2);border-radius:var(--r-md);padding:12px 16px;margin-bottom:16px}
@media (max-width:640px){.panel{padding:16px}.kpi .v{font-size:16px}h1{font-size:20px}}
`;
