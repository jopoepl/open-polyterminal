# Polymarket API Reference For Tool Routing

Last updated: 2026-02-07

## Base URLs
- Gamma metadata/search: `https://gamma-api.polymarket.com`
- CLOB market data: `https://clob.polymarket.com`
- Data API (trades/positions): `https://data-api.polymarket.com`

## Intent -> Endpoint Routing
- Discover events by keyword/tag/time window:
  - `GET /public-search` (Gamma), then `GET /events` or `GET /markets`
- List markets/outcomes for a known event:
  - `GET /events` (Gamma, filtered by `id` or `slug`)
- Get top-of-book quotes for a token:
  - `GET /book` (CLOB)
- Get historical price series for a token:
  - `GET /prices-history` (CLOB)
- Get recent trades/fills:
  - `GET /trades` (Data API) or `GET /data/trades` (CLOB docs)
- Get user positions:
  - `GET /positions` (Data API)

## Gamma API

### 1) Public Search
- Endpoint: `GET /public-search`
- Purpose: Unified search across events/markets for discovery.
- Key params:
  - `q` (string, required)
  - `limit_per_type` (number)
- Example:
```bash
curl 'https://gamma-api.polymarket.com/public-search?q=highest%20temperature&limit_per_type=100'
```

### 2) Events
- Endpoint: `GET /events`
- Purpose: Filterable event metadata with nested markets.
- Key params (commonly used):
  - `id`, `slug`
  - `limit`, `offset`
  - `active`, `closed`, `archived`
  - `tag_id`
  - `start_date_min`, `start_date_max`
  - `end_date_min`, `end_date_max`
  - `liquidity_num_min`, `liquidity_num_max`
  - `volume_num_min`, `volume_num_max`
  - `order`, `ascending`
- Example:
```bash
curl 'https://gamma-api.polymarket.com/events?closed=true&tag_id=103037&end_date_min=2026-01-31T00:00:00Z&limit=200'
```

### 3) Markets
- Endpoint: `GET /markets`
- Purpose: Filterable market-level metadata.
- Key params (commonly used):
  - `id`, `slug`, `event_id`, `question`
  - `clob_token_ids`
  - `active`, `closed`, `archived`
  - `start_date_min`, `start_date_max`
  - `end_date_min`, `end_date_max`
  - `liquidity_num_min`, `liquidity_num_max`
  - `volume_num_min`, `volume_num_max`
  - `limit`, `offset`, `order`, `ascending`
- Example:
```bash
curl 'https://gamma-api.polymarket.com/markets?event_id=12345&closed=true&limit=500'
```

### 4) Tags
- Endpoint: `GET /tags`
- Purpose: Category/tag discovery for query expansion.
- Key params:
  - `limit`, `offset`
- Example:
```bash
curl 'https://gamma-api.polymarket.com/tags?limit=500'
```

## CLOB API

### 5) Orderbook
- Endpoint: `GET /book`
- Purpose: Best bids/asks and depth for a token.
- Key params:
  - `token_id` (required)
- Example:
```bash
curl 'https://clob.polymarket.com/book?token_id=123456789'
```

### 6) Price History
- Endpoint: `GET /prices-history`
- Purpose: Historical time series for one token.
- Key params:
  - `market` (token id, required)
  - `startTs`, `endTs`, `fidelity`
  - OR `interval=max` with `fidelity`
- Example (windowed):
```bash
curl 'https://clob.polymarket.com/prices-history?market=123456789&startTs=1738886400&endTs=1739491200&fidelity=60'
```
- Example (max):
```bash
curl 'https://clob.polymarket.com/prices-history?market=123456789&interval=max&fidelity=1440'
```

### 7) Trades (CLOB Data)
- Endpoint: `GET /data/trades`
- Purpose: Trade stream/fills from CLOB side.
- Key params (documented):
  - `id`, `taker`, `maker`, `market`, `asset_id`, `side`
- Example:
```bash
curl 'https://clob.polymarket.com/data/trades?market=0xMarketId&asset_id=123456789&side=BUY'
```

## Data API

### 8) Trades
- Endpoint: `GET /trades`
- Purpose: Aggregated trade retrieval, often easiest for app consumption.
- Key params (commonly used):
  - `asset_id` (token/asset id)
  - `market` (market identifier)
  - `limit`, `offset` (if available)
- Example:
```bash
curl 'https://data-api.polymarket.com/trades?asset_id=123456789&limit=50'
```

### 9) User Positions
- Endpoint: `GET /positions`
- Purpose: User holdings/exposure.
- Key params (from docs):
  - `user` (wallet address)
  - `sizeThreshold`
  - `limit`, `offset`
  - `market`, `title`, `eventId`
  - `redeemable`, `mergeable`
  - `endDateMin`, `endDateMax`
- Example:
```bash
curl 'https://data-api.polymarket.com/positions?user=0xabc123...&sizeThreshold=0.1&limit=200&offset=0'
```

## Pattern: Winning Outcomes In Past 7 Days
1. Discover relevant closed events/markets via Gamma:
   - `GET /public-search?q=<topic>`
   - `GET /events?closed=true&end_date_min=<ISO-7d>`
2. For each market, read winner/resolution fields from Gamma event/market payload.
3. Use Data API/CLOB trades only if volume/fill confirmation is needed.

## Required IDs Cheatsheet
- Event-level analysis: `event_id` or `slug`
- Outcome-level pricing/orderbook: `clob_token_ids` -> `token_id`
- User exposure: `user` wallet address
- Trade stream: `asset_id` (token id) or market identifier

## Current Project Data Storage Notes
- Weather forecast/live detail is computed on-demand in API routes, not in a database.
- Server-side weather/event caches are in-memory only (process lifetime).
- Client-side weather/live values live in React state in `TerminalShell`.
- If persistent history is needed, add a DB layer and store snapshots per fetch cycle.

## Source Links
- Gamma docs: https://docs.polymarket.com/developers/gamma-markets-api/get-events
- Gamma markets docs: https://docs.polymarket.com/developers/gamma-markets-api/get-markets
- Data API positions docs: https://docs.polymarket.com/developers/CLOB/endpoints/get-positions
- Data API/CLOB trades docs: https://docs.polymarket.com/developers/CLOB/endpoints/get-trades
- CLOB orderbook docs: https://docs.polymarket.com/developers/CLOB/prices-books/get-book
- CLOB price history docs: https://docs.polymarket.com/developers/CLOB/prices-books/get-price-history
