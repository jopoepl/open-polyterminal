# Weather MCP Server

This server exposes weather-specific tools used by `/api/ask`.

## Entrypoints
- stdio: `scripts/weather-mcp-server.mjs`
- http: `scripts/weather-mcp-http.mjs`
- npm scripts:
  - `npm run mcp:weather`
  - `npm run mcp:weather:http`

Default HTTP endpoint:
- `http://127.0.0.1:8787/mcp`
- health: `http://127.0.0.1:8787/health`

## Tools
- `list_weather_stations`
- `resolve_weather_station`
- `get_metar_observation`
- `get_open_meteo_forecast`
- `get_polymarket_weather_events`
- `get_polymarket_event`
- `get_polymarket_trades`
- `get_polymarket_positions`
- `get_clob_orderbook`

## Notes
- Station mapping source: `src/data/weather-stations.json`
- METAR source: `https://aviationweather.gov/api/data/metar`
- Forecast source: `https://api.open-meteo.com/v1/forecast`

## Related Docs
- Multi-server setup: `docs/multi-mcp-setup.md`
- Polymarket MCP: `docs/polymarket-mcp-tools.md`
- News MCP: `docs/news-mcp-tools.md`
