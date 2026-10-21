"""Minimal Alpaca REST client (standard library only).

Docs: https://docs.alpaca.markets/us/docs/getting-started
Keys are read from the environment (or a local .env file, see .env.example):

    APCA_API_KEY_ID      your key id
    APCA_API_SECRET_KEY  your secret key
    APCA_API_BASE_URL    trading endpoint, defaults to the PAPER endpoint
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PAPER_URL = "https://paper-api.alpaca.markets"
DATA_URL = "https://data.alpaca.markets"


class AlpacaError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"Alpaca HTTP {status}: {body}")
        self.status = status
        self.body = body


def load_dotenv(path: Path) -> None:
    """Fill os.environ from KEY=VALUE lines without overriding real env vars."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class Alpaca:
    def __init__(self, key_id: str | None = None, secret: str | None = None,
                 base_url: str | None = None, data_url: str | None = None,
                 feed: str | None = None):
        self.key_id = key_id or os.environ.get("APCA_API_KEY_ID") or os.environ.get("ALPACA_API_KEY")
        self.secret = secret or os.environ.get("APCA_API_SECRET_KEY") or os.environ.get("ALPACA_SECRET_KEY")
        if not self.key_id or not self.secret:
            raise SystemExit("Missing Alpaca keys: set APCA_API_KEY_ID and APCA_API_SECRET_KEY "
                             "(env vars or alpaca_bot/.env).")
        self.base_url = (base_url or os.environ.get("APCA_API_BASE_URL") or PAPER_URL).rstrip("/")
        self.data_url = (data_url or os.environ.get("APCA_API_DATA_URL") or DATA_URL).rstrip("/")
        # "iex" works on the free plan; "sip" needs a paid market-data subscription.
        self.feed = feed or os.environ.get("APCA_DATA_FEED", "iex")

    @property
    def is_paper(self) -> bool:
        return "paper-api" in self.base_url

    # ------------------------------------------------------------ transport
    def _request(self, method: str, url: str, params: dict | None = None, body: dict | None = None):
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "APCA-API-KEY-ID": self.key_id,
            "APCA-API-SECRET-KEY": self.secret,
            "Accept": "application/json",
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            raise AlpacaError(e.code, e.read().decode(errors="replace")) from None
        return json.loads(raw) if raw else None

    def _trade(self, method: str, path: str, params=None, body=None):
        return self._request(method, self.base_url + path, params, body)

    # ------------------------------------------------------------ trading API
    def account(self) -> dict:
        return self._trade("GET", "/v2/account")

    def clock(self) -> dict:
        return self._trade("GET", "/v2/clock")

    def positions(self) -> list[dict]:
        return self._trade("GET", "/v2/positions")

    def asset(self, symbol: str) -> dict:
        return self._trade("GET", f"/v2/assets/{urllib.parse.quote(symbol)}")

    def orders(self, status: str = "all", after: str | None = None, limit: int = 500) -> list[dict]:
        return self._trade("GET", "/v2/orders", {"status": status, "after": after,
                                                 "limit": limit, "direction": "desc"})

    def get_order(self, order_id: str) -> dict:
        return self._trade("GET", f"/v2/orders/{order_id}")

    def cancel_order(self, order_id: str) -> None:
        self._trade("DELETE", f"/v2/orders/{order_id}")

    def submit_order(self, symbol: str, side: str, qty: float, client_order_id: str) -> dict:
        return self._trade("POST", "/v2/orders", body={
            "symbol": symbol, "side": side, "type": "market", "time_in_force": "day",
            "qty": f"{qty:g}", "client_order_id": client_order_id,
        })

    def portfolio_history(self, period: str = "1A", timeframe: str = "1D", start: str | None = None) -> dict:
        params = {"timeframe": timeframe}
        if start:
            params["start"] = start
        else:
            params["period"] = period
        return self._trade("GET", "/v2/account/portfolio/history", params)

    def fills(self, after: str | None = None) -> list[dict]:
        return self._trade("GET", "/v2/account/activities/FILL",
                           {"after": after, "direction": "desc", "page_size": 100})

    # ------------------------------------------------------------ market data
    def daily_bars(self, symbols: list[str], start: str, end: str | None = None) -> dict[str, list[dict]]:
        """{symbol: [{t, o, h, l, c, v, ...}]} of split/dividend-adjusted daily bars, oldest first."""
        out: dict[str, list[dict]] = {}
        for i in range(0, len(symbols), 50):   # keep URLs short
            token = None
            while True:
                page = self._request("GET", self.data_url + "/v2/stocks/bars", {
                    "symbols": ",".join(symbols[i:i + 50]), "timeframe": "1Day",
                    "start": start, "end": end, "adjustment": "all", "feed": self.feed,
                    "limit": 10000, "page_token": token,
                })
                for sym, bars in (page.get("bars") or {}).items():
                    out.setdefault(sym, []).extend(bars)
                token = page.get("next_page_token")
                if not token:
                    break
        return out
