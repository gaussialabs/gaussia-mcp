# Changelog

## v0.1.0 · 2026-11-27

First release. A stdio MCP server for TESS exoplanet signals.

- `toi_lookup`: TOIs by TIC ID or TOI number from the public ExoFOP TOI table, with dispositions, period, epoch, duration, depth, planet radius, SNR and sectors as ExoFOP gives them.
- The TOI table is downloaded once (about 4 MB) and kept in memory for the life of the process. Concurrent calls share one download.
- Requests time out (90 s for the TOI table). A failed source comes back as a tool error that names it (`source_unavailable: ExoFOP TOI table: HTTP 503`); no tool substitutes data.
- Unit tests replay a recorded ExoFOP response (fetched 2026-11-27); live tests run with `pnpm test:live`.
