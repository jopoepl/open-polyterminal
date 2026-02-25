# News MCP Server

Temporary news provider for analysis context.

## Entrypoints
- stdio: `scripts/news-mcp-server.mjs`
- http: `scripts/news-mcp-http.mjs`
- npm scripts:
  - `npm run mcp:news`
  - `npm run mcp:news:http`

Default HTTP endpoint:
- `http://127.0.0.1:8789/mcp`
- health: `http://127.0.0.1:8789/health`

## Tools
- `news_search_articles`
- `news_topic_snapshot`
- `news_topic_timeline`

## Provider
- Default open API: GDELT Doc API (`https://api.gdeltproject.org/api/v2/doc/doc`)
- Override base URL with `NEWS_API_BASE_URL`
