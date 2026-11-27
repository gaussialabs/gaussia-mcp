# Changelog

## v0.9.1 · 2026-11-27

- `crossmatch_signal` also checks TOIs on neighbouring stars within `neighbour_radius_arcsec` (default 126″, six 21″ TESS pixels; 0 turns it off). A match returns `known_toi` with the neighbour's TIC and separation: the signal most likely leaks in from that star.
- The target position comes from its own TOI rows when it has any, otherwise from the MAST TIC (one extra request). If MAST has no position, the error says how to skip the check.
- `gaussia://rules/crossmatch` documents the neighbour rule.

## v0.9.0 · 2026-11-27

- MCP resources: `gaussia://rules/crossmatch` (the cross-match rules, generated from the same constants the tool uses), `gaussia://sources` (every endpoint and its credit line), `gaussia://spec/commitment` (SPEC.md) and `gaussia://vectors/commitment`.
- MCP prompt `filter_signal`: the Filter step for one signal: `crossmatch_signal`, then `vet_signal`, then `tess_observations`, then a short note that uses only tool numbers and says "candidate", never "planet".

## v0.8.0 · 2026-11-27

- `vet_signal`: two rough physical checks from the host star's TIC radius, mass and contamination ratio. (1) Implied planet radius from the depth (Rp/R* = √depth, plus a version with the TIC contamination removed), flagging `deep_eclipse` (Rp/R* ≥ 0.5) and `too_large_for_planet` (> 2 R_Jup). (2) The observed duration against the longest central transit for a circular orbit (Kepler's third law), flagging `too_long` (> 1.5×), `very_short` (< 0.15×) and `inside_star`. Also `crowded` when the contamination ratio is above 0.5.
- The result lists its assumptions and says plainly what it does not test (odd/even depths, secondary eclipse, shape, centroids: they need the light curve).
- Math tests: Earth's a/R* ≈ 215 and 13-hour central transit; a 1% dip on the Sun ≈ 1 R_Jup.

## v0.7.0 · 2026-11-27

- `sealed_commit`: computes the blind-matching commitment `keccak256(abi.encode(bytes32 jobId, bytes32 resultHash, address wallet, bytes32 salt))` with viem. Generates a 32-byte salt when none is given and says to keep it secret.
- `verify_reveal`: checks one to three reveals against their commitments; with two or more, applies the matching rule (`verified` with outliers, `mismatch` → third node, `incomplete`). A wallet counts once.
- `SPEC.md` (draft v0) defines the commitment and the matching rule; `vectors/commitment.json` holds two test vectors, checked with viem and independently with Python eth-abi + pycryptodome. Both ship in the npm package.
- Mixed-case wallet addresses must carry a valid EIP-55 checksum.

## v0.6.0 · 2026-11-27

- Every request is retried on network errors, timeouts and HTTP 408/425/429/5xx: 2 retries by default (`GAUSSIA_RETRIES`, 0-5), backoff 1 s then 3 s, or the server's `Retry-After` up to 10 s. Errors say how many attempts were made (`MAST TIC catalog: HTTP 502 after 3 attempts`). A 404 is not retried.
- The ExoFOP TOI table is fetched again once it is older than `GAUSSIA_TOI_TTL_HOURS` (default 6). If that refresh fails, the previous copy is served for up to 7 days with `source.stale` and a warning line saying why and when it was downloaded; older than that, the error is returned.

## v0.5.0 · 2026-11-27

- `crossmatch_signal` now also checks the star's confirmed planets from the NASA Exoplanet Archive (TAP, `pscomppars`, matched by TIC ID) and returns `known_planet` when a planet matches at 1× with aligned transit times. A planet beats a TOI when both match.
- Planets not known to transit (`tran_flag = 0`, e.g. radial-velocity planets) are compared by period only; the archive's predicted conjunction time is not used as a transit epoch.
- If the archive is down the tool returns a source error instead of a verdict from the TOI table alone.
- Recorded archive answers for L 98-59, TOI-700, TOI-101 (WASP-46) and a star with no planets (fetched 2026-11-27).

## v0.4.0 · 2026-11-27

- `crossmatch_signal`: checks a transit signal (TIC, period, epoch, duration) against the TOIs on the same star. A match needs the period at known × n/m (1, 1/2, 2, 1/3, 3, 2/3, 3/2) within a relative tolerance (default 0.2%, or 3σ of the known period if larger) and transit times that coincide after propagating the TOI ephemeris (window: half the longer duration, or 3σ of the propagated ephemeris). A same-period signal at phase 0.5 is flagged as a likely secondary eclipse.
- Verdicts `known_toi`, `alias_of_known`, `no_match`, each with reasons; period matches whose transit times do not line up are returned as `near_misses`.
- Epochs in BJD_TDB or BTJD (auto-detected or set with `epoch_format`).
- Alias and epoch math tests, plus tool tests on the recorded ExoFOP table (L 98-59 c at 1× and 2×, a TOI-101.01 secondary eclipse, a random period).

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
