# Forecast vs Market Movement Plan (Start From Scratch)

## Objective
Build a research workflow to test whether forecast changes can predict short-term Polymarket bucket price moves and produce a repeatable, profitable trading rule.

## Core Question
When forecast max temperature shifts (for example 8 -> 9), do related market buckets move enough and fast enough to trade after spread/slippage/fees?

## Scope (Phase 1)
- Cities: London, Dallas, Miami
- Market type: Daily highest-temperature weather markets
- Horizon: last 3-6 months for study, then live forward-paper tracking
- Models: `ecmwf_ifs`, `gfs_seamless`, `icon_global` (expand later)

## Data Sources
- Forecast movement:
  - `https://previous-runs-api.open-meteo.com/v1/forecast`
  - `https://historical-forecast-api.open-meteo.com/v1/forecast`
- Market movement:
  - Gamma API for event/market metadata
  - CLOB/Data API for bucket prices, orderbook, and/or trades
- Resolution/ground truth (validation only):
  - METAR / station history (Iowa Mesonet or station feeds)

## Important Constraint
- Open-Meteo gives easy `previous_day1`, `previous_day2`, `previous_day3` comparisons.
- Exact intra-day backfill like true "12h ago run" is limited unless reconstructed from raw model archives or captured with your own snapshot logger.
- Therefore:
  - Use archive endpoints for historical day-level drift now.
  - Add logger for exact future 1h/6h/12h drift.

## Project Structure
Create this under the working repo:

```text
analysis/forecast-vs-market/
  data/
    raw/
      forecasts/
      markets/
    processed/
  scripts/
    fetch_forecast_history.ts
    fetch_market_history.ts
    build_event_table.ts
    run_event_study.ts
    make_plots.ts
  output/
    tables/
    charts/
  README.md
```

## Canonical Event Table
One row per timestamp x bucket x model:

- `timestamp_utc`
- `city`
- `market_date`
- `market_slug`
- `bucket_label`
- `bucket_mid_price`
- `bucket_best_bid`
- `bucket_best_ask`
- `bucket_spread`
- `bucket_volume_window`
- `model`
- `forecast_target_max`
- `forecast_delta_1d`
- `forecast_delta_2d`
- `forecast_bucket` (mapped integer bucket)
- `distance_bucket_to_forecast`

## Signal Definitions (Initial)
- `S1`: forecast max changes by >= 1 degree since previous day (`delta_1d`)
- `S2`: two-model agreement on same directional change
- `S3`: forecast bucket shift toward higher/lower bucket
- `S4`: confidence filter using model dispersion (optional)

## Trade Simulation Rules (Initial)
- Entry:
  - Trigger at signal timestamp
  - Buy corresponding bucket (or NO on adjacent bucket logic as separate test)
- Exit:
  - Take profit: +10c and +20c variants
  - Time stop: 1h / 3h / end-of-day
  - Signal reversal stop
- Costs:
  - Include spread crossing and slippage assumptions
  - Enforce minimum executable size (CLOB min shares)

## Plots To Produce
- Forecast vs market overlay (time series)
- Scatter: forecast delta vs forward return (`+15m`, `+1h`, `+3h`)
- Heatmap: distance-to-forecast bucket vs forward return
- Distribution: post-signal returns by model and city
- Cumulative PnL curves by strategy variant

## Validation Checklist
- Check signal leakage (no future data)
- Confirm timezone alignment (market close vs local weather day)
- Validate slug/date mapping edge cases (pre/post February slug format changes)
- Reject trades that violate actual minimum order size
- Out-of-sample split by month

## Deliverables
- `event_table.parquet` (clean merged dataset)
- `signal_stats.csv` (hit rate, avg return, t-cost return)
- `strategy_backtest.csv` (trades and PnL)
- chart set in `output/charts/`
- short findings memo: what works, what fails, what to deploy

## Execution Plan
1. Build historical dataset for London/Dallas/Miami.
2. Generate event table and sanity-check 3 specific dates manually.
3. Run event study (no trading logic yet).
4. Run backtest variants with realistic execution constraints.
5. Pick one robust strategy and paper-trade live for 7 days.
6. Promote to live only if paper/live slippage matches assumptions.

## Risk Notes
- Forecast changes can be fully priced in before your fill.
- High-price buckets can fail due min share rules even if dollar size seems valid.
- Overfitting by city/day/weather regime is likely without holdout testing.
- Synthetic NO logic must use executable side and depth-aware pricing.

## First Tasks (Tomorrow)
1. Implement `fetch_forecast_history.ts` for 3 cities + 3 models.
2. Implement `fetch_market_history.ts` for matching market dates/buckets.
3. Build and inspect first 2-week London event table.
4. Produce first overlay chart and signal-return scatter.
