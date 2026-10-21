# Alpaca trading bot

Runs the strategy in [Jaswanth-dev-69/Trade](https://github.com/Jaswanth-dev-69/Trade)
(`agent.py`, trend rotation with a 3x index sleeve) on an Alpaca account, and shows
how it is doing. The Trade repo is only cloned and read; nothing here changes it.

- `bot.py trade` fetches ~1 year of daily bars from Alpaca, builds the
  `market_state` / `portfolio_state` that `agent.decide()` expects, and sends the
  orders it returns as market orders. It uses only completed daily bars, so
  during market hours today's partial bar is left out.
- `bot.py status` prints account value, today's P&L, return since start compared
  with SPY and QQQ over the same days, max drawdown, Sharpe, positions and recent
  fills, and writes the same thing with a chart to `reports/report.html`.

Paper trading is the default. A real-money endpoint is refused unless you pass `--live`.

## Setup

Python 3.9+ and nothing to install (standard library only).

1. Create an Alpaca account and open the **Paper Trading** dashboard.
   Generate API keys there ([getting started](https://docs.alpaca.markets/us/docs/getting-started)).
2. `cp alpaca_bot/.env.example alpaca_bot/.env` and paste in your key id and secret.
   `.env` is gitignored.
3. From `alpaca_bot/`:

```bash
python bot.py trade --dry-run   # see what the bot wants to do
python bot.py trade             # place those orders on the paper account
python bot.py status            # how is it performing?
```

If `../Trade` is missing, `bot.py` clones it first.

Run `trade` once per market day (it skips if it already traded today; `--force`
overrides). Any time works: before the open the orders queue for the open, and
during the session they fill right away.

## Run it daily on GitHub instead

`.github/workflows/alpaca-bot.yml` runs `trade` then `status` every weekday at
10:45 New York time. To turn it on, add two repository secrets
(Settings → Secrets and variables → Actions): `APCA_API_KEY_ID` and
`APCA_API_SECRET_KEY`. Each run's summary shows the report, and the HTML page is
attached as the `performance-report` artifact. Without the secrets the workflow
does nothing. It always uses the paper endpoint.

## Check the plumbing offline

```bash
python selftest.py
```

Runs `trade` and `status` against a fake in-memory account with synthetic prices.
It tests the wiring only; its numbers say nothing about the strategy.
