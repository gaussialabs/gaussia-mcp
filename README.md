# gaussia-mcp

An MCP server that gives AI agents real TESS exoplanet tools, for [Gaussia](https://gaussia.app): a volunteer search for exoplanet candidates in open NASA TESS data.

Every tool reads public data at call time. No API keys, no accounts, no mock data: when a source is down, the tool says which one.

Status: v0.1.0, early. Tools so far:

| Tool | What it does | Source |
|---|---|---|
| `toi_lookup` | TOIs by TIC ID or TOI number, with dispositions and ephemerides as given | ExoFOP TOI table |

## Install

Node 20 or newer.

```sh
git clone https://github.com/gaussialabs/gaussia-mcp.git
cd gaussia-mcp
pnpm install && pnpm build
```

Claude Code, local checkout:

```sh
claude mcp add gaussia -- node /path/to/gaussia-mcp/dist/index.js
```

## Development

```sh
pnpm test        # unit tests on recorded responses (tests/fixtures, dates in sources.json)
pnpm test:live   # the same tools against the live sources
pnpm typecheck
```

## Data credits

This research uses the Exoplanet Follow-up Observing Program (ExoFOP; DOI 10.26134/ExoFOP5) website, operated by the California Institute of Technology under contract with NASA. TESS data are public NASA data.

## License

Apache-2.0
