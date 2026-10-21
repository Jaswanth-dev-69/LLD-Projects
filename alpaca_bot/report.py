"""Performance report for the Alpaca account the bot trades: terminal text + a standalone HTML page."""
from __future__ import annotations

import html
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
BENCHMARKS = ("SPY", "QQQ")


@dataclass
class Report:
    text: str
    html: str


# ---------------------------------------------------------------- numbers
def equity_curve(history: dict, since: str | None) -> list[tuple[str, float]]:
    """[(YYYY-MM-DD, equity)] from portfolio history, skipping unfunded/empty days."""
    out: dict[str, float] = {}
    for ts, eq in zip(history.get("timestamp") or [], history.get("equity") or []):
        if eq is None or eq <= 0:
            continue
        day = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(NY).date().isoformat()
        if since and day < since:
            continue
        out[day] = float(eq)
    return sorted(out.items())


def benchmark_curves(bars: dict[str, list[dict]], days: list[str]) -> dict[str, list[float | None]]:
    """Each benchmark's return since days[0], aligned to the bot's dates (carry last close forward)."""
    from bot import bar_day
    curves = {}
    for sym in BENCHMARKS:
        closes = sorted((bar_day(b["t"]), b["c"]) for b in bars.get(sym, []))
        aligned, i, last = [], 0, None
        for d in days:
            while i < len(closes) and closes[i][0] <= d:
                last = closes[i][1]
                i += 1
            aligned.append(last)
        base = next((x for x in aligned if x), None)
        curves[sym] = [(x / base - 1.0) if (x and base) else None for x in aligned]
    return curves


def stats(curve: list[tuple[str, float]]) -> dict:
    eq = [e for _, e in curve]
    rets = [eq[i] / eq[i - 1] - 1.0 for i in range(1, len(eq))]
    peak, mdd = eq[0], 0.0
    for e in eq:
        peak = max(peak, e)
        mdd = min(mdd, e / peak - 1.0)
    out = {"start": curve[0][0], "end": curve[-1][0], "start_eq": eq[0], "end_eq": eq[-1],
           "total": eq[-1] / eq[0] - 1.0, "mdd": mdd, "days": len(rets),
           "vol": None, "sharpe": None, "best": None, "worst": None}
    if len(rets) >= 2:
        mean = sum(rets) / len(rets)
        sd = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1))
        out["vol"] = sd * math.sqrt(252)
        out["sharpe"] = mean / sd * math.sqrt(252) if sd > 0 else None
    if rets:
        out["best"], out["worst"] = max(rets), min(rets)
    return out


def pct(x, signed=True) -> str:
    return "n/a" if x is None else (f"{x:+.2%}" if signed else f"{x:.2%}")


def money(x, signed=False) -> str:
    return f"{'+' if signed and x >= 0 else '-' if x < 0 else ''}${abs(x):,.2f}"


# ---------------------------------------------------------------- report
def build_report(api, since: str | None = None) -> Report:
    account = api.account()
    positions = api.positions()
    history = api.portfolio_history(period="1A")
    curve = equity_curve(history, since)
    try:
        fills = api.fills()[:10]
    except Exception:  # noqa: BLE001 - activities are optional for the report
        fills = []

    equity = float(account["equity"])
    day_pnl = equity - float(account["last_equity"])
    if not curve:
        curve = [(datetime.now(NY).date().isoformat(), equity)]
    days = [d for d, _ in curve]
    s = stats(curve)
    bench = benchmark_curves(api.daily_bars(list(BENCHMARKS), start=days[0]), days)
    bench_total = {k: next((x for x in reversed(v) if x is not None), None) for k, v in bench.items()}

    rows = []
    for p in sorted(positions, key=lambda p: -float(p["market_value"])):
        mv = float(p["market_value"])
        rows.append({"sym": p["symbol"], "qty": float(p["qty"]), "price": float(p["current_price"]),
                     "value": mv, "weight": mv / equity if equity else 0.0,
                     "upl": float(p["unrealized_pl"]), "uplpc": float(p["unrealized_plpc"])})

    # ---------------- text
    sharpe = "n/a" if s["sharpe"] is None else f"{s['sharpe']:.2f}"
    L = [f"=== Bot performance ({'PAPER' if api.is_paper else 'LIVE'} account) ===",
         f"Equity        {money(equity)}   (cash {money(float(account['cash']))})",
         f"Today         {money(day_pnl, True)}  ({pct(day_pnl / float(account['last_equity']) if float(account['last_equity']) else None)})",
         f"Since {s['start']}  {money(s['end_eq'] - s['start_eq'], True)}  ({pct(s['total'])}) over {s['days']} sessions",
         "  vs " + "   ".join(f"{k} {pct(v)}" for k, v in bench_total.items()),
         f"Max drawdown  {pct(s['mdd'], False)}   ann. vol {pct(s['vol'], False)}   Sharpe {sharpe}",
         "", f"Positions ({len(rows)}):"]
    for r in rows:
        L.append(f"  {r['sym']:6} {r['qty']:>12,.3f} @ {r['price']:>9,.2f}  {money(r['value']):>14}  "
                 f"{r['weight']:>6.1%}  P&L {money(r['upl'], True)} ({pct(r['uplpc'])})")
    if not rows:
        L.append("  (all cash)")
    if fills:
        L += ["", "Recent fills:"]
        for f in fills:
            L.append(f"  {f.get('transaction_time', '')[:16].replace('T', ' ')}  {f['side']:4} "
                     f"{float(f['qty']):>10,.3f} {f['symbol']:6} @ {float(f['price']):,.2f}")
    text = "\n".join(L)

    return Report(text=text, html=render_html(account, s, day_pnl, bench_total, curve, bench, rows, fills,
                                              api.is_paper))


# ---------------------------------------------------------------- html
def _chart(days: list[str], series: dict[str, list[float | None]]) -> str:
    W, H, PL, PR, PT, PB = 760, 280, 52, 12, 12, 28
    vals = [v for s in series.values() for v in s if v is not None] or [0.0]
    lo, hi = min(min(vals), 0.0), max(max(vals), 0.0)
    pad = (hi - lo) * 0.08 or 0.01
    lo, hi = lo - pad, hi + pad
    n = max(len(days) - 1, 1)
    x = lambda i: PL + (W - PL - PR) * i / n
    y = lambda v: PT + (H - PT - PB) * (hi - v) / (hi - lo)
    parts = []
    for k in range(5):
        v = lo + (hi - lo) * k / 4
        parts.append(f'<line x1="{PL}" x2="{W - PR}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="grid"/>'
                     f'<text x="{PL - 6}" y="{y(v) + 4:.1f}" class="tick" text-anchor="end">{v:+.1%}</text>')
    parts.append(f'<line x1="{PL}" x2="{W - PR}" y1="{y(0):.1f}" y2="{y(0):.1f}" class="zero"/>')
    for i in sorted({0, len(days) // 2, len(days) - 1}):
        anchor = "start" if i == 0 else "end" if i == len(days) - 1 else "middle"
        parts.append(f'<text x="{x(i):.1f}" y="{H - 8}" class="tick" text-anchor="{anchor}">{days[i]}</text>')
    for name, cls in (("QQQ", "s3"), ("SPY", "s2"), ("Bot", "s1")):
        pts = [f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(series.get(name, [])) if v is not None]
        if len(pts) == 1:
            parts.append(f'<circle cx="{pts[0].split(",")[0]}" cy="{pts[0].split(",")[1]}" r="3" class="{cls} dot"/>')
        elif pts:
            parts.append(f'<polyline points="{" ".join(pts)}" class="{cls} line"/>')
    return f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Return since start: bot vs SPY vs QQQ">{"".join(parts)}</svg>'


def render_html(account, s, day_pnl, bench_total, curve, bench, rows, fills, paper: bool) -> str:
    e = html.escape
    days = [d for d, _ in curve]
    series = {"Bot": [eq / curve[0][1] - 1.0 for _, eq in curve], **bench}
    tone = lambda v: "" if v is None else ("pos" if v >= 0 else "neg")
    tiles = [
        ("Equity", money(float(account["equity"])), ""),
        ("Today", money(day_pnl, True), tone(day_pnl)),
        (f"Since {s['start']}", pct(s["total"]), tone(s["total"])),
        *((f"{k} same period", pct(v), tone(v)) for k, v in bench_total.items()),
        ("Max drawdown", pct(s["mdd"], False), "neg" if s["mdd"] < 0 else ""),
        ("Sharpe (ann.)", "n/a" if s["sharpe"] is None else f"{s['sharpe']:.2f}", ""),
    ]
    tile_html = "".join(f'<div class="tile"><div class="lbl">{e(a)}</div><div class="val {c}">{e(b)}</div></div>'
                        for a, b, c in tiles)
    pos_html = "".join(
        f"<tr><td>{e(r['sym'])}</td><td>{r['qty']:,.3f}</td><td>{r['price']:,.2f}</td><td>{money(r['value'])}</td>"
        f"<td>{r['weight']:.1%}</td><td class='{tone(r['upl'])}'>{money(r['upl'], True)} ({pct(r['uplpc'])})</td></tr>"
        for r in rows) or '<tr><td colspan="6">All cash</td></tr>'
    fill_html = "".join(
        f"<tr><td>{e(f.get('transaction_time', '')[:16].replace('T', ' '))}</td><td>{e(f['side'])}</td>"
        f"<td>{float(f['qty']):,.3f}</td><td>{e(f['symbol'])}</td><td>{float(f['price']):,.2f}</td></tr>"
        for f in fills) or '<tr><td colspan="5">No fills yet</td></tr>'
    generated = datetime.now(NY).strftime("%Y-%m-%d %H:%M NY")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trading Bot Performance</title>
<style>
:root{{--bg:#fafaf9;--card:#fff;--ink:#1c1917;--mute:#78716c;--line:#e7e5e4;--pos:#15803d;--neg:#b91c1c;
--s1:#2563eb;--s2:#a8a29e;--s3:#d97706}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#0c0a09;--card:#1c1917;--ink:#f5f5f4;
--mute:#a8a29e;--line:#292524;--pos:#4ade80;--neg:#f87171;--s1:#60a5fa;--s2:#78716c;--s3:#fbbf24}}}}
:root[data-theme="dark"]{{--bg:#0c0a09;--card:#1c1917;--ink:#f5f5f4;--mute:#a8a29e;--line:#292524;
--pos:#4ade80;--neg:#f87171;--s1:#60a5fa;--s2:#78716c;--s3:#fbbf24}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}}
main{{max-width:880px;margin:0 auto;padding:24px 16px 48px}}h1{{font-size:22px;margin:0 0 4px}}
h2{{font-size:15px;margin:28px 0 10px}}.sub{{color:var(--mute);font-size:13px}}
.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:18px}}
.tile,.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}}
.lbl{{color:var(--mute);font-size:12px}}.val{{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}}
.pos{{color:var(--pos)}}.neg{{color:var(--neg)}}svg{{width:100%;height:auto;display:block}}
.grid{{stroke:var(--line)}}.zero{{stroke:var(--mute);stroke-dasharray:3 3}}.tick{{fill:var(--mute);font-size:11px}}
.line{{fill:none;stroke-width:2}}.s1{{stroke:var(--s1);fill:var(--s1)}}.s2{{stroke:var(--s2);fill:var(--s2)}}
.s3{{stroke:var(--s3);fill:var(--s3)}}.line.s1,.line.s2,.line.s3{{fill:none}}.line.s1{{stroke-width:2.5}}
.legend{{display:flex;gap:16px;font-size:13px;color:var(--mute);margin-bottom:6px}}
.legend i{{display:inline-block;width:12px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}}
.scroll{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px}}
th,td{{text-align:right;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}}
th:first-child,td:first-child{{text-align:left}}th{{color:var(--mute);font-weight:500;font-size:12px}}
</style></head><body><main>
<h1>Trading bot performance</h1>
<div class="sub">{'Paper' if paper else 'LIVE'} Alpaca account · {e(s['start'])} → {e(s['end'])} · {s['days']} sessions · generated {e(generated)}</div>
<div class="tiles">{tile_html}</div>
<h2>Return since start</h2>
<div class="card"><div class="legend"><span><i style="background:var(--s1)"></i>Bot</span>
<span><i style="background:var(--s2)"></i>SPY</span><span><i style="background:var(--s3)"></i>QQQ</span></div>
{_chart(days, series)}</div>
<h2>Positions</h2>
<div class="card scroll"><table><tr><th>Ticker</th><th>Qty</th><th>Price</th><th>Value</th><th>Weight</th><th>Unrealized P&amp;L</th></tr>{pos_html}</table></div>
<h2>Recent fills</h2>
<div class="card scroll"><table><tr><th>Time (UTC)</th><th>Side</th><th>Qty</th><th>Ticker</th><th>Price</th></tr>{fill_html}</table></div>
</main></body></html>
"""
