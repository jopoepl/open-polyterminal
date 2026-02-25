# Polymarket MCP Server

Dedicated Polymarket data server for analysis queries.

## Entrypoints
- stdio: `scripts/polymarket-mcp-server.mjs`
- http: `scripts/polymarket-mcp-http.mjs`
- npm scripts:
  - `npm run mcp:polymarket`
  - `npm run mcp:polymarket:http`

Default HTTP endpoint:
- `http://127.0.0.1:8788/mcp`
- health: `http://127.0.0.1:8788/health`

## Tools
- `pm_status`
- `pm_search`
- `pm_list_events`
- `pm_list_markets`
- `pm_get_event`
- `pm_get_market`
- `pm_get_trades`
- `pm_get_positions`
- `pm_get_orderbook`
- `pm_get_price_history`

## Upstream APIs
- Gamma API: `https://gamma-api.polymarket.com`
- Data API: `https://data-api.polymarket.com`
- CLOB API: `https://clob.polymarket.com`

Reference used while implementing:
- `docs/polymarket_endpoints_detailed.csv`
