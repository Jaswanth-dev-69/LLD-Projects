"""Run the Trade repo's agent.py on an Alpaca account and see how it performs.

    python bot.py trade --dry-run   # show what the bot would do, place nothing
    python bot.py trade             # place the bot's orders (paper account by default)
    python bot.py status            # performance report + reports/report.html

The strategy itself is untouched: this file only feeds agent.decide() real
Alpaca data and sends the orders it returns. Run `trade` once per market day;
like the contest engine, it decides on the last completed daily close and its
market orders fill at the next open (or right away if the market is open).
"""
from __future__ import annotations

import argparse
import importlib.util
import math
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from alpaca_client import Alpaca, AlpacaError, load_dotenv

HERE = Path(__file__).resolve().parent
TRADE_REPO = HERE.parent / "Trade"
TRADE_URL = "https://github.com/Jaswanth-dev-69/Trade"
NY = ZoneInfo("America/New_York")
ORDER_TAG = "lldbot"           # client_order_id prefix, marks orders this bot placed
HISTORY_DAYS = 420             # calendar days of bars to fetch (~290 sessions)
MAX_BARS = 260                 # bars handed to decide() per ticker

# Everything agent.py ranks or trades (same list as Trade/live_runner.py).
UNIVERSE = [
    "SPY", "QQQ",
    "NVDA", "MSFT", "AAPL", "META", "AMZN", "GOOGL", "AVGO", "AMD", "MU", "MRVL",
    "NFLX", "TSLA", "PLTR", "ORCL", "CRM", "JPM", "V", "MA", "COST", "LLY",
    "SMH", "XLK", "XLC", "XLY", "XLF", "XLI", "XLE", "XLV", "XLP", "XLU",
    "XLRE", "DIA", "IWM", "SOXX", "QLD", "SSO", "TQQQ", "SOXL", "UPRO", "SPXL",
]


# ---------------------------------------------------------------- agent
def ensure_trade_repo() -> None:
    """Clone the Trade repo next to this folder if it is missing (read-only use)."""
    if (TRADE_REPO / "agent.py").exists():
        return
    print(f"Cloning {TRADE_URL} into {TRADE_REPO} ...")
    subprocess.run(["git", "clone", "--depth", "1", TRADE_URL, str(TRADE_REPO)], check=True)


def load_agent(path: Path):
    spec = importlib.util.spec_from_file_location("trade_agent", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.dont_write_bytecode = True   # leave no __pycache__ in the Trade clone
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.dont_write_bytecode = False
    if not hasattr(mod, "decide"):
        raise SystemExit(f"{path} has no decide()")
    return mod


# ---------------------------------------------------------------- data shaping
def bar_day(ts: str) -> str:
    """Alpaca bar timestamp (UTC) -> New York session date YYYY-MM-DD."""
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return dt.astimezone(NY).date().isoformat()


def build_market_state(raw: dict[str, list[dict]], drop_day: str | None) -> dict[str, list[dict]]:
    """Alpaca bars -> the {ticker: [{ts, open, high, low, close, volume}]} shape decide() expects.

    drop_day removes the still-forming bar of a session in progress."""
    out = {}
    for sym, bars in raw.items():
        rows = [{"ts": bar_day(b["t"]), "open": b["o"], "high": b["h"], "low": b["l"],
                 "close": b["c"], "volume": b["v"]} for b in bars]
        rows = [r for r in rows if r["ts"] != drop_day]
        rows.sort(key=lambda r: r["ts"])
        if rows:
            out[sym] = rows[-MAX_BARS:]
    return out


def build_portfolio_state(account: dict, positions: list[dict], market_state: dict) -> dict:
    last = {t: bars[-1]["close"] for t, bars in market_state.items()}
    pos = []
    for p in positions:
        qty = float(p["qty"])
        if qty <= 0:          # agent.py is long-only; ignore any shorts
            continue
        sym = p["symbol"]
        pos.append({"ticker": sym, "quantity": qty, "avg_cost": float(p["avg_entry_price"])})
        last.setdefault(sym, float(p["current_price"]))
    return {"cash": float(account["cash"]), "positions": pos, "last_prices": last}


# ---------------------------------------------------------------- trade
def bot_orders_today(api: Alpaca, today: str) -> list[dict]:
    start = datetime.fromisoformat(today).replace(tzinfo=NY).astimezone(timezone.utc)
    return [o for o in api.orders(status="all", after=start.isoformat())
            if str(o.get("client_order_id", "")).startswith(ORDER_TAG)]


def order_qty(api: Alpaca, order: dict, held: dict[str, float], cache: dict) -> float:
    """Quantity Alpaca will accept: whole shares for non-fractionable assets, sells capped at holdings."""
    sym, qty = order["ticker"], float(order["quantity"])
    if order["side"] == "sell":
        qty = min(qty, held.get(sym, 0.0))
    if sym not in cache:
        cache[sym] = bool(api.asset(sym).get("fractionable"))
    if not cache[sym]:
        qty = math.floor(qty)
    return math.floor(qty * 1e6) / 1e6


def wait_for_fills(api: Alpaca, ids: list[str], timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    pending = set(ids)
    while pending and time.time() < deadline:
        time.sleep(2)
        for oid in list(pending):
            if api.get_order(oid)["status"] in ("filled", "canceled", "expired", "rejected"):
                pending.discard(oid)


def cmd_trade(api: Alpaca, args) -> int:
    if not api.is_paper and not args.live:
        raise SystemExit("APCA_API_BASE_URL is not the paper endpoint. Pass --live to trade real money.")
    ensure_trade_repo()
    agent = load_agent(Path(args.agent))

    clock = api.clock()
    now = datetime.fromisoformat(clock["timestamp"].replace("Z", "+00:00")).astimezone(NY)
    today = now.date().isoformat()
    print(f"[{now:%Y-%m-%d %H:%M} NY] market {'OPEN' if clock['is_open'] else 'closed'}, "
          f"{'PAPER' if api.is_paper else 'LIVE'} account")

    done = bot_orders_today(api, today)
    if done and not args.force:
        print(f"Bot already placed {len(done)} order(s) today; nothing to do (use --force to rerun).")
        return 0
    if not args.dry_run:
        for o in api.orders(status="open"):
            if str(o.get("client_order_id", "")).startswith(ORDER_TAG):
                api.cancel_order(o["id"])
                print(f"  cancelled stale order {o['side']} {o['qty']} {o['symbol']}")

    account, positions = api.account(), api.positions()
    held = {p["symbol"]: float(p["qty"]) for p in positions if float(p["qty"]) > 0}
    symbols = sorted(set(UNIVERSE) | set(held))
    start = (now.date() - timedelta(days=HISTORY_DAYS)).isoformat()
    raw = api.daily_bars(symbols, start=start)
    market_state = build_market_state(raw, drop_day=today if clock["is_open"] else None)
    portfolio_state = build_portfolio_state(account, positions, market_state)
    last_day = max((b[-1]["ts"] for b in market_state.values()), default="?")
    print(f"Equity ${float(account['equity']):,.2f}  cash ${float(account['cash']):,.2f}  "
          f"positions {len(held)}  bars for {len(market_state)} tickers through {last_day}")

    orders = agent.decide(market_state, portfolio_state, portfolio_state["cash"])
    if not orders:
        print("Bot decided: no trades today.")
        return 0
    print(f"Bot decided {len(orders)} order(s):")
    for o in orders:
        print(f"  {o['side'].upper():4} {float(o['quantity']):>12,.3f} {o['ticker']}")
    if args.dry_run:
        print("Dry run: no orders sent.")
        return 0

    stamp = now.strftime("%Y%m%d%H%M%S")
    cache: dict[str, bool] = {}
    sells = [o for o in orders if o["side"] == "sell"]
    buys = [o for o in orders if o["side"] == "buy"]
    sent: list[str] = []

    def send(n: int, o: dict) -> None:
        qty = order_qty(api, o, held, cache)
        if qty <= 0:
            print(f"  skip {o['side']} {o['ticker']}: quantity rounds to 0")
            return
        try:
            r = api.submit_order(o["ticker"], o["side"], qty, f"{ORDER_TAG}-{stamp}-{n}")
            sent.append(r["id"])
            print(f"  sent {o['side']} {qty:g} {o['ticker']} -> {r['status']}")
        except AlpacaError as e:
            print(f"  FAILED {o['side']} {qty:g} {o['ticker']}: {e}")

    for n, o in enumerate(sells):
        send(n, o)
    if sent and buys and clock["is_open"]:
        wait_for_fills(api, sent)   # free up buying power before buying
    for n, o in enumerate(buys, start=len(sells)):
        send(n, o)
    if not clock["is_open"]:
        print(f"Market closed: orders fill at the next open ({clock['next_open']}).")
    return 0


# ---------------------------------------------------------------- status
def cmd_status(api: Alpaca, args) -> int:
    from report import build_report
    report = build_report(api, since=args.since)
    print(report.text)
    out = HERE / "reports" / "report.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(report.html)
    print(f"\nHTML report: {out}")
    return 0


def main(argv=None) -> int:
    load_dotenv(HERE / ".env")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("trade", help="run agent.decide() and place its orders")
    t.add_argument("--dry-run", action="store_true", help="print the orders, send nothing")
    t.add_argument("--force", action="store_true", help="run even if the bot already traded today")
    t.add_argument("--live", action="store_true", help="allow a non-paper (real money) account")
    t.add_argument("--agent", default=str(TRADE_REPO / "agent.py"), help="path to the agent file")
    s = sub.add_parser("status", help="show how the bot is performing")
    s.add_argument("--since", help="measure from this date (YYYY-MM-DD); default: account start")
    args = p.parse_args(argv)
    api = Alpaca()
    return cmd_trade(api, args) if args.cmd == "trade" else cmd_status(api, args)


if __name__ == "__main__":
    sys.exit(main())
