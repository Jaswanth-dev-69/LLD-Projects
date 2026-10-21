"""Offline test: runs `trade` and `status` against a fake in-memory Alpaca account.

    python selftest.py

No keys or network needed. Proves the plumbing (data shaping, decide() call,
order sizing, report) works; it says nothing about how the strategy performs.
"""
from __future__ import annotations

import io
import random
import sys
import types
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bot  # noqa: E402
from report import build_report  # noqa: E402

TODAY = date(2026, 10, 21)


def sessions(n: int) -> list[date]:
    out, d = [], TODAY - timedelta(days=1)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


class FakeAlpaca:
    is_paper = True

    def __init__(self, is_open: bool):
        rnd = random.Random(7)
        days = sessions(280)
        self.is_open = is_open
        self.bars = {}
        for sym in bot.UNIVERSE:   # steady uptrend so the agent goes risk-on
            px, drift = 100.0, 0.0015 * (3 if sym in ("TQQQ", "SOXL", "UPRO", "SPXL") else 1)
            rows = []
            for d in days + ([TODAY] if is_open else []):
                px *= 1 + drift + rnd.gauss(0, 0.006)
                t = datetime(d.year, d.month, d.day, 4, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
                rows.append({"t": t, "o": px, "h": px * 1.01, "l": px * 0.99, "c": px, "v": 1_000_000})
            self.bars[sym] = rows
        self.cash = 100_000.0
        self.pos = {"XLU": 50.0}
        self.sent: list[dict] = []
        self.daily_bar_calls: list[list[str]] = []

    def _px(self, sym):
        return self.bars[sym][-1]["c"]

    def clock(self):
        return {"timestamp": "2026-10-21T11:00:00-04:00" if self.is_open else "2026-10-21T08:00:00-04:00",
                "is_open": self.is_open, "next_open": "2026-10-21T09:30:00-04:00"}

    def account(self):
        eq = self.cash + sum(q * self._px(s) for s, q in self.pos.items())
        return {"cash": str(self.cash), "equity": str(eq), "last_equity": str(eq * 0.99)}

    def positions(self):
        return [{"symbol": s, "qty": str(q), "avg_entry_price": "90", "current_price": str(self._px(s)),
                 "market_value": str(q * self._px(s)), "unrealized_pl": str(q * (self._px(s) - 90)),
                 "unrealized_plpc": str(self._px(s) / 90 - 1)} for s, q in self.pos.items()]

    def orders(self, status="all", after=None, limit=500):
        return [{"id": o["id"], "client_order_id": o["cid"], "side": o["side"], "qty": o["qty"],
                 "symbol": o["sym"], "status": "accepted"} for o in self.sent]

    def cancel_order(self, oid):
        pass

    def asset(self, sym):
        return {"fractionable": sym != "SOXL"}

    def get_order(self, oid):
        return {"status": "filled"}

    def submit_order(self, symbol, side, qty, client_order_id):
        assert qty > 0 and side in ("buy", "sell")
        self.sent.append({"id": f"o{len(self.sent)}", "cid": client_order_id, "sym": symbol,
                          "side": side, "qty": qty})
        return {"id": f"o{len(self.sent)}", "status": "accepted"}

    def daily_bars(self, symbols, start, end=None):
        self.daily_bar_calls.append(list(symbols))
        return {s: [b for b in self.bars[s] if b["t"][:10] >= start] for s in symbols if s in self.bars}

    def portfolio_history(self, period="1A", timeframe="1D", start=None):
        days = sessions(30)
        ts = [int(datetime(d.year, d.month, d.day, 20, tzinfo=timezone.utc).timestamp()) for d in days]
        eq = [None, 0] + [100_000 * (1 + 0.002 * i) for i in range(len(days) - 2)]
        return {"timestamp": ts, "equity": eq}

    def fills(self, after=None):
        return [{"transaction_time": "2026-10-20T13:30:01Z", "side": "buy", "qty": "10",
                 "symbol": "QQQ", "price": "500.1"}]


def run(api, *argv):
    buf = io.StringIO()
    args = types.SimpleNamespace(dry_run="--dry-run" in argv, force="--force" in argv, live=False,
                                 agent=str(bot.TRADE_REPO / "agent.py"))
    with redirect_stdout(buf):
        bot.cmd_trade(api, args)
    return buf.getvalue()


def main() -> int:
    # 1. dry run sends nothing but shows a plan
    api = FakeAlpaca(is_open=False)
    out = run(api, "--dry-run")
    assert "Bot decided" in out and not api.sent, out
    assert "XLU" in api.daily_bar_calls[0], "held symbols must be fetched too"

    # 2. real run (market closed) places orders; second run the same day is a no-op
    out = run(api)
    assert api.sent, out
    assert all(o["cid"].startswith(bot.ORDER_TAG) for o in api.sent)
    for o in api.sent:
        if o["sym"] == "SOXL":
            assert float(o["qty"]).is_integer(), "non-fractionable asset must get whole shares"
        if o["side"] == "sell":
            assert o["qty"] <= api.pos.get(o["sym"], 0)
    n = len(api.sent)
    assert "already placed" in run(api) and len(api.sent) == n

    # 3. market open: today's still-forming bar must not reach decide()
    raw = FakeAlpaca(is_open=True).bars
    ms = bot.build_market_state(raw, drop_day=TODAY.isoformat())
    assert all(b[-1]["ts"] < TODAY.isoformat() for b in ms.values())
    assert all(len(b) <= bot.MAX_BARS for b in ms.values())
    out = run(FakeAlpaca(is_open=True))
    assert "sent" in out or "no trades" in out, out

    # 4. status report
    rep = build_report(FakeAlpaca(is_open=False))
    assert "Equity" in rep.text and "SPY" in rep.text and "<svg" in rep.html, rep.text
    print(rep.text)
    print(f"\nselftest OK — {n} orders placed on the fake account:")
    for o in api.sent:
        print(f"  {o['side']:4} {o['qty']:>10g} {o['sym']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
