# gaussia-mcp

An MCP server that gives AI agents real TESS exoplanet tools, for [Gaussia](https://gaussia.app): a volunteer search for exoplanet candidates in open NASA TESS data.

In Gaussia's pipeline, AI agents filter the signals that volunteer nodes find and cross-match them against existing catalogs, so known planets are never claimed as new. This server is that toolbox. It is open source and usable on its own by any agent that works with TESS data.

- Every tool reads public data at call time: ExoFOP, the NASA Exoplanet Archive and MAST. No API keys, no accounts.
- No mock data. When a source fails, the tool returns an error that names the source; nothing is filled in.
- Every number in a result comes from a named source, with the time it was fetched.

## Tools

| Tool | What it does | Source |
|---|---|---|
| `crossmatch_signal` | Checks a transit signal (TIC, period, epoch, duration) against the TOIs and confirmed planets on its star and TOIs on neighbouring stars. Covers period aliases n/m up to 3, transit-time alignment and secondary eclipses at phase 0.5. Verdict `known_planet`, `known_toi`, `alias_of_known` or `no_match`, with reasons | ExoFOP TOI table + NASA Exoplanet Archive (+ MAST for position) |
| `toi_lookup` | TOIs by TIC ID or TOI number: dispositions, period, epoch, duration, depth, radius, SNR, sectors, as ExoFOP gives them | ExoFOP TOI table |
| `tess_observations` | The sectors that observed a star: FFI footprint (camera/CCD), SPOC 2-min and 20-s light curves, and HLSP light curves (QLP, TESS-SPOC, ...) with their cadence | MAST TESScut + CAOM |
| `star_info` | TIC v8.2 parameters: Tmag, Teff, log g, radius, mass, density, distance, contamination, Gaia/2MASS IDs | MAST TIC catalog |
| `vet_signal` | Two rough physical checks: the planet radius implied by the depth, and the duration against the longest transit the star allows | MAST TIC catalog |
| `sealed_commit` | Blind-matching commitment `keccak256(abi.encode(jobId, resultHash, wallet, salt))` ([SPEC.md](SPEC.md)) | offline |
| `verify_reveal` | Checks one to three node reveals against their commitments and applies the matching rule: `verified` with outliers, `mismatch`, `incomplete` | offline |

Resources:

- `gaussia://rules/crossmatch`: how verdicts are decided, with the current tolerances.
- `gaussia://sources`: every endpoint and its credit line.
- `gaussia://spec/commitment` and `gaussia://vectors/commitment`: the commitment spec and its test vectors.

Prompt: `filter_signal` runs the Filter step for one signal: crossmatch, vet, coverage, then a short note.

## Real outputs

From `pnpm demo` on 2026-11-27: the built server over stdio, against the live sources. The first call includes the one-time ExoFOP table download (~20 s).

A known planet. L 98-59 c, given ExoFOP's TOI-175.01 ephemeris:

```text
$ crossmatch_signal {"tic_id":307210830,"period_days":3.6906758578,"epoch":2460688.70837,"duration_hours":1.107}
Verdict for TIC 307210830, P=3.6906758578 d: known_planet
- period 3.690676 d = 1x L 98-59 c (confirmed)'s 3.690676 d (diff 0.000015%), and transit times line up (offset 0 h, window ±0.64 h over 629 orbits)
- period 3.690676 d = 1x TOI-175.01 (CP)'s 3.690676 d (diff 5.9e-11%), and transit times line up (offset 0 h, window ±0.55 h over 0 orbits)
Checked 3 TOI(s) (ExoFOP, fetched 2026-11-27T03:21:59.706Z) and 5 confirmed planet(s) (NASA Exoplanet Archive) on the star, and 0 TOI(s) on stars within 126".
```

TOI-700 d, with its epoch given in BTJD:

```text
$ crossmatch_signal {"tic_id":"TIC 150428135","period_days":37.4236838,"epoch":1330.486155,"duration_hours":3.365}
Verdict for TIC 150428135, P=37.4236838 d: known_planet
- period 37.423684 d = 1x TOI-700 d (confirmed)'s 37.423457 d (diff 0.00061%), and transit times line up (offset -0.13 h, window ±1.68 h over 65 orbits)
- period 37.423684 d = 1x TOI-700.02 (CP)'s 37.423684 d (diff 7.3e-8%), and transit times line up (offset 0 h, window ±1.68 h over 0 orbits)
Checked 4 TOI(s) (ExoFOP, fetched 2026-11-27T03:21:59.706Z) and 4 confirmed planet(s) (NASA Exoplanet Archive) on the star, and 0 TOI(s) on stars within 126".
```

Twice the period of L 98-59 b is caught as an alias:

```text
$ crossmatch_signal {"tic_id":307210830,"period_days":4.5062123,"epoch":2458354.907237,"duration_hours":1}
Verdict for TIC 307210830, P=4.5062123 d: alias_of_known
- period 4.506212 d = 2x L 98-59 b (confirmed)'s 2.253114 d (diff 0.00035%), and transit times line up (offset 0.05 h, window ±0.51 h over 5 orbits)
- period 4.506212 d = 2x TOI-175.03 (CP)'s 2.253106 d (diff 5.2e-7%), and transit times line up (offset 0 h, window ±0.5 h over 0 orbits)
Checked 3 TOI(s) (ExoFOP, fetched 2026-11-27T03:21:59.706Z) and 5 confirmed planet(s) (NASA Exoplanet Archive) on the star, and 0 TOI(s) on stars within 126".
```

A made-up period on the same star finds nothing. This is not a discovery, only "nothing known here":

```text
$ crossmatch_signal {"tic_id":307210830,"period_days":5.4321,"epoch":2459500.123,"duration_hours":1.5}
Verdict for TIC 307210830, P=5.4321 d: no_match
- No period within the tolerance of 8 known objects at ratios 1, 1/2, 2, 1/3, 3, 2/3, 3/2.
Checked 3 TOI(s) (ExoFOP, fetched 2026-11-27T03:21:59.706Z) and 5 confirmed planet(s) (NASA Exoplanet Archive) on the star, and 0 TOI(s) on stars within 126".
```

The other tools:

```text
$ toi_lookup {"toi":"TOI-700"}
4 TOIs for TOI 700 (ExoFOP, fetched 2026-11-27T03:21:59.706Z):
TOI-700.01 (TIC 150428135) TFOPWG CP, TESS CP: P=16.051106 d, epoch BJD 2459303.157062, dur 1.397 h, depth 2769 ppm, Rp 2.587 R_earth — TOI-700 c / TOI-700.01
TOI-700.02 (TIC 150428135) TFOPWG CP, TESS CP: P=37.423684 d, epoch BJD 2458330.486155, dur 3.365 h, depth 737.6 ppm, Rp 1.33 R_earth — TOI-700 d / TOI-700.02
TOI-700.03 (TIC 150428135) TFOPWG CP, TESS CP: P=9.977273 d, epoch BJD 2458331.349645, dur 2.258 h, depth 459.9 ppm, Rp 0.9617 R_earth — TOI-700 b / TOI-700.03
TOI-700.04 (TIC 150428135) TFOPWG CP, TESS CP: P=27.80969 d, epoch BJD 2458352.99952, dur 2.956 h, depth 406.8 ppm, Rp 0.9492 R_earth — TOI-700 e / TOI-700.04
```

```text
$ star_info {"tic_id":307210830}
TIC 307210830 (STAR, DWARF): Tmag 9.412, Teff 3429 K, R 0.3142 R_sun, M 0.2928 M_sun, distance 10.62 pc, contamination ratio 0.00293. Source: MAST TIC v8.2.
```

```text
$ tess_observations {"tic_id":307210830}
TIC 307210830: 28 TESS sectors with data at MAST.
In full-frame images (TESScut): 1, 2, 5, 8, 9, 10, 11, 12, 28, 29, 32, 35, 36, 37, 38, 39, 61, 62, 63, 64, 65, 69, 87, 88, 89, 90, 96, 98.
SPOC 2-min light curves: 2, 5, 8, 9, 10, 11, 12, 28, 29, 32, 35, 36, 37, 38, 39, 61, 62, 63, 64, 65, 69, 87, 88, 89, 90, 96, 98.
SPOC 20-s light curves: 28, 29, 32, 35, 36, 37, 38, 39, 61, 62, 63, 64, 65, 69, 87, 88, 89, 90, 96, 98.
High-level light curves (QLP, TESS-SPOC, ...) in sectors: 2, 5, 8, 9, 10, 11, 12, 28, 29, 32, 35, 36, 37, 38, 39, 61, 62, 63, 64, 65, 69, 87, 88, 89, 90, 96, 98.
```

```text
$ vet_signal {"tic_id":307210830,"period_days":3.6906758578,"duration_hours":1.107,"depth_ppm":1657}
TIC 307210830 (R 0.3142 R_sun, M 0.2928 M_sun from TIC v8.2): Rp/R* 0.0407, Rp ≈ 1.39 R_earth (0.124 R_Jup).
Longest central transit at P=3.6906758578 d: 1.38 h (a/R* 21.2); observed 1.107 h = 0.801x.
No flags from these two checks.
Rough screens only; odd/even, secondary eclipse and shape need the light curve and are not run here.
```

```text
$ vet_signal {"tic_id":307210830,"period_days":3.69,"duration_hours":6,"depth_ppm":300000}
TIC 307210830 (R 0.3142 R_sun, M 0.2928 M_sun from TIC v8.2): Rp/R* 0.548, Rp ≈ 18.8 R_earth (1.67 R_Jup).
Longest central transit at P=3.69 d: 2.06 h (a/R* 21.2); observed 6 h = 2.92x.
Flags:
- deep_eclipse: depth 300000 ppm means Rp/R* = 0.55: an object half the star's size or more is almost always a stellar companion (eclipsing binary)
- too_long: duration 6 h is 2.92x the longest central transit (2.06 h) for this star: possible blend on a larger star, wrong stellar parameters, a wrong period, or an eccentric orbit
Rough screens only; odd/even, secondary eclipse and shape need the light curve and are not run here.
```

```text
$ sealed_commit {"job_id":"0x1111111111111111111111111111111111111111111111111111111111111111","result_hash":"0x2222222222222222222222222222222222222222222222222222222222222222","wallet":"0x3333333333333333333333333333333333333333","salt":"0x4444444444444444444444444444444444444444444444444444444444444444"}
Commitment 0xe60df2107077d59eb706432a888b7ed8626a905471df0f245646ca6455d8b7e5 for job 0x1111111111111111111111111111111111111111111111111111111111111111, wallet 0x3333333333333333333333333333333333333333.
```

## Install

Node 20 or newer. Not on npm yet: install from a checkout.

```sh
git clone https://github.com/gaussialabs/gaussia-mcp.git
cd gaussia-mcp
pnpm install && pnpm build
```

Claude Code, local checkout:

```sh
claude mcp add gaussia -- node /absolute/path/to/gaussia-mcp/dist/index.js
```

After npm publish (not published yet):

```sh
claude mcp add gaussia -- npx gaussia-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gaussia": {
      "command": "node",
      "args": ["/absolute/path/to/gaussia-mcp/dist/index.js"]
    }
  }
}
```

### HTTP

```sh
node dist/index.js --http --port 3333            # POST http://127.0.0.1:3333/mcp, GET /healthz
```

The HTTP transport is stateless Streamable HTTP. It binds to 127.0.0.1 by default, refuses foreign `Host` headers (`--allow-host name` adds one) and has no authentication. Keep it local, or put it behind a proxy that adds auth.

## Configuration

All optional. Set them in the MCP client's `env`.

| Variable | Default | Meaning |
|---|---|---|
| `GAUSSIA_TOI_TTL_HOURS` | `6` | How long the downloaded ExoFOP TOI table is reused (0-168). If a refresh fails, the previous copy (up to 7 days old) is served and the result marks it stale. |
| `GAUSSIA_RETRIES` | `2` | Extra attempts after a network error, timeout or HTTP 408/425/429/5xx (0-5). Backoff is 1 s, 3 s, 9 s, or the server's `Retry-After` up to 10 s. |

## How the cross-match decides

1. **Period.** P matches a known period Pk at n/m (1, 1/2, 2, 1/3, 3, 2/3, 3/2) when |P − Pk·n/m| ≤ max(0.2% of Pk·n/m, 3σ of Pk·n/m). The tolerance is set with `period_tolerance`.
2. **Transit times.** With P = Pk·n/m, the two series of transits coincide only if the epoch difference is a multiple of Pk/m. The offset must fit within half the longer duration, or within 3σ of the known ephemeris propagated to the signal's epoch, whichever is larger.
3. **Secondary eclipse.** A signal with the same period but transit times at phase 0.5 counts as `alias_of_known`.
4. Planets not known to transit (e.g. RV planets) are compared by period only.
5. TOIs on stars within 126″ (six TESS pixels; set with `neighbour_radius_arcsec`) are checked the same way.

The full rules are in the `gaussia://rules/crossmatch` resource.

## Honest limits

- `no_match` means only that the ExoFOP TOI table and the Exoplanet Archive's composite table have nothing at that period and phase on that star. Other things can still explain the signal: CTOIs that are not TOIs, eclipsing-binary catalogs, planets on neighbouring stars and systematics. None of these are checked.
- `vet_signal` is two rough checks from catalog values. It does not read light curves, so odd/even depths, secondary eclipses, transit shape and centroid shifts are not tested. Gaussia's node pipeline is meant to do those, and it is not built yet.
- The tools do not download or search light curves. `tess_observations` reports what exists at MAST.
- The archive match uses TIC IDs from `pscomppars`. A planet whose archive entry has no TIC ID is missed.
- Gaussia itself is at concept stage: nodes, the coordinator, review, contracts and the token are not deployed. `sealed_commit` and `verify_reveal` implement the draft commitment format in [SPEC.md](SPEC.md) so it can be checked before those parts exist.
- The first ExoFOP call downloads ~4 MB and takes 10-30 s.

## Development

```sh
pnpm test        # unit tests on recorded responses (tests/fixtures; sources and dates in sources.json)
pnpm test:live   # the same tools against the live sources (GAUSSIA_LIVE=1)
pnpm typecheck
pnpm build && pnpm demo
```

## Data sources and credits

- [ExoFOP](https://exofop.ipac.caltech.edu/tess/) TOI table. This research uses the Exoplanet Follow-up Observing Program (ExoFOP; DOI 10.26134/ExoFOP5) website, operated by the California Institute of Technology under contract with NASA under the Exoplanet Exploration Program.
- [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/), Planetary Systems Composite Parameters table (DOI 10.26133/NEA13), via TAP. This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology under contract with NASA under the Exoplanet Exploration Program.
- [MAST](https://mast.stsci.edu/) at the Space Telescope Science Institute: the TESS Input Catalog v8.2 (Stassun et al. 2019, AJ 158, 138), CAOM observation records and TESScut. STScI is operated by AURA under NASA contract NAS5-26555.
- TESS mission data are public NASA data. Funding for the TESS mission is provided by NASA's Science Mission Directorate.

The server only reads these public services and does not redistribute their data. The recorded responses in `tests/fixtures` are small samples kept for tests.

## Related repos

- [`gaussia-search`](https://github.com/gaussialabs/gaussia-search): the open transit search a node runs on TESS light curves.
- [`gaussia-match`](https://github.com/gaussialabs/gaussia-match): commit-reveal matching, tiebreak, sealed votes and candidate hashes. It uses the same commitment as `sealed_commit` here; the vectors in `vectors/commitment.json` match in both.

## License

Apache-2.0. See [LICENSE](LICENSE). Security reports: [SECURITY.md](SECURITY.md).
