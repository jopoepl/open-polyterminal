# Historical Tab v2 Implementation Plan

## Goal
Add a new `Historical` right-panel tab that shows model accuracy over past completed days for the selected weather market.

## Scope (MVP)
1. Daily-only accuracy (no hourly mode yet)
2. Periods: `3d`, `1w`, `1m`
3. Metrics per model: MAE, RMSE, bias, accuracy-within-2°
4. Historical chart: observed high + model predicted highs
5. Leaderboard with rank, sample count, and coverage
6. Quality metadata and explicit scoring policy in API response

## Deferred (Post-MVP)
1. Hourly mode
2. Confidence bands
3. Error sparklines
4. Animated line drawing
5. ERA5 fallback

## Data & Scoring Policy
1. Observations source: Iowa Mesonet METAR (station-local day aggregation)
2. Forecast source: Open-Meteo Historical Forecast API daily max temps
3. Evaluation window: completed local days only (end = yesterday in station timezone)
4. Day matching: station local calendar day
5. Eligibility: `minSamplesPerModel = 3`
6. Coverage metric: `sampleCount / totalObservedDays`

## API Contract
`GET /api/historical-accuracy?city=Phoenix&period=1w&unit=F`

Response includes:
- `station`, `period`, `policy`
- `dailySeries` (observed + per-model predictions/errors)
- `modelAccuracy` sorted by MAE (with `sampleCount`, `coveragePct`, `eligible`)
- `bestModel` (only among eligible models)
- `warnings` (missing data / partial model coverage)

## Implementation Steps
1. Add shared accuracy types and calculation helpers (`src/lib/accuracy/*`)
2. Implement `src/pages/api/historical-accuracy.ts`
3. Implement `src/hooks/useHistoricalAccuracy.ts` with small in-memory cache
4. Add UI components:
   - `HistoricalPanel`
   - `HistoricalChart`
   - `HistoricalLeaderboard`
   - `HistoricalPeriodSelector`
5. Integrate new `historical` tab in `TerminalShell`
6. Add styles in `src/styles/globals.css`
7. Validate with `npm run build`

## Validation Checklist
1. API responds for all period values
2. Ranking excludes ineligible models (`sampleCount < 3`)
3. Tooltip/legend values align with returned metrics
4. Non-weather events show clear empty state
5. Build passes
