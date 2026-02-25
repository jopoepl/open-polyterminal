---
name: polymarket-api-router
description: Route Polymarket analysis questions to the correct Gamma, CLOB, and Data API endpoints with exact parameters and request patterns. Use when implementing data collection, writing API routes, or answering scoped market questions that need events, markets, orderbooks, trades, user positions, price history, or resolved outcomes.
---

# Polymarket API Router

## Overview
Route a market-analysis request to the right Polymarket endpoint and produce an executable request plan.
Use this skill whenever a task needs concrete endpoint selection, query parameters, pagination, or time-window filtering.

## Workflow
1. Parse the request intent and scope.
2. Load `references/polymarket-api-reference.md`.
3. Select endpoint(s) from the routing table.
4. Return exact request specs: base URL, required params, optional params, and example request.
5. Keep analysis scoped to the target event, market, asset, or user.

## Guardrails
- Prefer the minimum endpoint set that answers the question.
- Keep web lookups scoped to settlement-relevant facts only.
- If an identifier is missing (event id, market id, token id, wallet), ask for it or show discovery step first.
- Distinguish clearly between:
  - `gamma-api.polymarket.com` (event/market discovery metadata)
  - `clob.polymarket.com` (orderbook and price history)
  - `data-api.polymarket.com` (trades and user positions)

## Common Task Mapping
- Find weather markets by query/tag/date:
  - Use Gamma `public-search`, then Gamma `events` / `markets` filters.
- Show live top-of-book for outcomes:
  - Use CLOB `book` with token ids.
- Fetch recent fills/trades:
  - Use Data API `trades` (or CLOB data trades when needed by market).
- Fetch account exposure:
  - Use Data API `positions` with `user` and optional filters.
- Compute winners in past week:
  - Discover closed events/markets via Gamma, then inspect resolved/winner fields and timestamps.

## References
- `references/polymarket-api-reference.md`
