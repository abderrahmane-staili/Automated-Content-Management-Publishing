# Workflows

Export your workflows from n8n (**… → Download**) and drop the JSON files here:

| File | Purpose |
|------|---------|
| `main.json`  | Orchestrator: schedule → scrape sources → filter → WordPress → Google Sheets → dispatch |
| `sub-1.json` … `sub-4.json` | One sub-workflow per bot. Each loops over its share of groups and calls `http://host.docker.internal:300X/post-to-group` |

> ⚠️ **Before committing:** remove credentials, API keys, tokens, Telegram chat IDs,
> Google Sheet IDs and personal URLs from the JSON. n8n exports reference
> credentials by name/ID, but HTTP Request / Code nodes may contain secrets inline.
