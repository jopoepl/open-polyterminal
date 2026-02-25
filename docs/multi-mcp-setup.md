# Multi-MCP Setup

`/api/ask` now supports three MCP servers simultaneously:
- `weather`
- `polymarket`
- `news`

- The handler probes HTTP MCP URLs by default to verify reachability before each request.
- Set `MCP_SKIP_RUNTIME_PROBE=1` to rely on static HTTP config without probing.

Each server can run in:
- `http` mode (if URL is reachable)
- `stdio` fallback mode (default when no reachable URL)
- `disabled` (via env)

## Env Controls
Per server, these env vars are supported:
- `<PREFIX>_ENABLED` (`0` disables server)
- `<PREFIX>_URL` (HTTP MCP endpoint)
- `<PREFIX>_NODE_BIN` (node binary for stdio mode)
- `<PREFIX>_STARTUP_TIMEOUT_SEC`
- `<PREFIX>_TOOL_TIMEOUT_SEC`

Prefixes:
- Weather: `WEATHER_MCP`
- Polymarket: `POLYMARKET_MCP`
- News: `NEWS_MCP`

Weather-only default URL fallback used by `/api/ask`:
- `WEATHER_MCP_DEFAULT_URL` (default `http://127.0.0.1:8787/mcp`)

## Example
```bash
WEATHER_MCP_URL=http://127.0.0.1:8787/mcp
POLYMARKET_MCP_URL=http://127.0.0.1:8788/mcp
NEWS_MCP_URL=http://127.0.0.1:8789/mcp
```
