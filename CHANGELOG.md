# Changelog

## v0.3.0 · 2026-11-27

- `tess_observations`: the TESS sectors that observed a TIC, one row per sector: in the full-frame images or not (MAST TESScut, with camera and CCD), SPOC 2-min and 20-s light curves (MAST CAOM), and HLSP light curves (QLP, TESS-SPOC, TASOC, TGLC, CDIPS, ...) with cadence. Top-level `has_spoc_2min` and sector lists.
- SPOC multi-sector DV products are not counted as sectors; multi-sector HLSPs (e.g. DIAMANTE) are listed separately.
- Recorded TESScut and CAOM responses for L 98-59 and TOI-700 (fetched 2026-11-27).

## v0.2.0 · 2026-11-27

- `star_info`: a star's TIC v8.2 parameters from MAST (Tmag, Teff, log g, radius, mass, density, luminosity class, distance, parallax, contamination ratio, TIC disposition, Gaia DR2 / 2MASS / HIP IDs). Says so when the TIC has no such ID.
- MAST Portal API client (`/api/v0/invoke`, keyless) with a 45 s timeout. A MAST answer other than `COMPLETE` is reported as a source error with MAST's own message.
- Recorded MAST responses for L 98-59, TOI-700 and a missing TIC (fetched 2026-11-27).

## v0.1.0 · 2026-11-27

First release. A stdio MCP server for TESS exoplanet signals.

- `toi_lookup`: TOIs by TIC ID or TOI number from the public ExoFOP TOI table, with dispositions, period, epoch, duration, depth, planet radius, SNR and sectors as ExoFOP gives them.
- The TOI table is downloaded once (about 4 MB) and kept in memory for the life of the process. Concurrent calls share one download.
- Requests time out (90 s for the TOI table). A failed source comes back as a tool error that names it (`source_unavailable: ExoFOP TOI table: HTTP 503`); no tool substitutes data.
- Unit tests replay a recorded ExoFOP response (fetched 2026-11-27); live tests run with `pnpm test:live`.
