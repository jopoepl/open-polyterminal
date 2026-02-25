# PolyTerminal

A clean, open-source Polymarket terminal with category hubs (weather, sports, politics, and more). Built with a Pages Router–only Next.js 14 setup (no RSC, no server actions).

## Features
- Full-screen terminal UI with light/dark modes
- Category-driven event browser with weather date filters and non-weather ranking filters
- Outcome table with YES/NO prices, volume, and liquidity
- Multi-line chart for all YES outcomes (1H / 1D / 1W / 1M / Max)
- Optional live orderbook updates via Polymarket WS

## Quickstart
```bash
cd /path/to/poly-terminal
npm install
npm run dev
```

Open `http://localhost:3000`.

## Security Guardrails
Enable local secret-scanning hooks before committing:

```bash
npm run hooks:install
```

Manual scans:

```bash
npm run secret:scan          # tracked files
npm run secret:scan:staged   # staged changes only
npm run secret:scan:history  # full git history
```

## Data Sources
- **Gamma API**: market and event metadata
- **CLOB API**: price history and live orderbook (optional)
- **Data API**: trades, positions
- **METAR**: aviationweather.gov for observations
- **Open-Meteo**: forecast highs
- **GDELT Doc API**: open news context feed

## MCP Servers
- Weather MCP: `scripts/weather-mcp-server.mjs` and `scripts/weather-mcp-http.mjs`
- Polymarket MCP: `scripts/polymarket-mcp-server.mjs` and `scripts/polymarket-mcp-http.mjs`
- News MCP: `scripts/news-mcp-server.mjs` and `scripts/news-mcp-http.mjs`
- Multi-MCP wiring for AI providers lives in `src/lib/ai.ts`
- Setup docs:
  - `docs/multi-mcp-setup.md`
  - `docs/weather-mcp-tools.md`
  - `docs/polymarket-mcp-tools.md`
  - `docs/news-mcp-tools.md`

## Configuration
No required environment variables for v0.1.

To prevent runtime MCP probing once the URLs are stable, set `MCP_SKIP_RUNTIME_PROBE=1` along with the `*_MCP_URL` values before starting Next.

Optional feature flags (client-side):
- Live updates are disabled by default in the UI. You can enable them with the “Enable live” button.

## Project Structure
```
poly-terminal/
  src/
    pages/
      api/
      index.tsx
    components/
    hooks/
    styles/
  scripts/
  docs/
```

## Notes
- Weather market parsing uses city matching and date extraction from the market title.
- Price history is proxied through `/api/price-history` to avoid browser CORS issues.

## Security
This project does not include trading keys or wallet integrations. It only reads public data.

## License
MIT (see `LICENSE`).

## Disclaimer
This project is for research and informational purposes only. It does not constitute financial advice.
