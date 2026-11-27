import { readFileSync } from "node:fs";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { RATIOS } from "./crossmatch.js";
import { ARCHIVE_TAP } from "./sources/archive.js";
import { TOI_URL } from "./sources/exofop.js";
import { MAST_INVOKE, TESSCUT_URL } from "./sources/mast.js";
import { DEFAULT_PERIOD_TOLERANCE } from "./tools.js";

/** SPEC.md and vectors/ ship next to dist/ (and next to src/ in a checkout). */
function packageFile(rel: string): string | null {
  try {
    return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
}

export function crossmatchRules(): string {
  const ratios = RATIOS.map((r) => (r.m === 1 ? `${r.n}` : `${r.n}/${r.m}`)).join(", ");
  return `# Gaussia cross-match rules (as implemented by crossmatch_signal)

Known objects on the star: TOIs from the ExoFOP TOI table, confirmed planets from the NASA Exoplanet Archive (pscomppars, matched by TIC ID).

1. Period. The signal period P matches a known period Pk at ratio n/m if |P - Pk*n/m| <= max(tol * Pk*n/m, 3 * sigma(Pk) * n/m).
   Ratios: ${ratios}. Default tol = ${DEFAULT_PERIOD_TOLERANCE} (set with period_tolerance).
2. Epoch. With P = Pk*n/m and gcd(n, m) = 1, the two transit series coincide only if (T0 - Tk) is a multiple of Pk/m.
   The offset to the nearest such time must be within max(half the longer duration, 3 * sigma), where
   sigma = sqrt(sigma(Tk)^2 + (N * sigma(Pk))^2) and N is the number of known orbits between Tk and T0.
3. Secondary eclipse. Same period (1x), transit times off, but the signal sits at phase 0.5 of the known orbit (same window).
4. Planets not known to transit (tran_flag = 0) are compared by period only.

Verdicts, strongest first:
- known_planet: 1x period and aligned epoch with a confirmed planet.
- known_toi: 1x period and aligned epoch with a TOI (any disposition, including false positives).
- alias_of_known: an aligned n/m alias, a secondary eclipse at phase 0.5, or a period match to an object without a transit epoch.
- no_match: none of the above. Period matches whose transit times do not line up are listed as near_misses.

no_match is not a discovery. It means these two catalogs have nothing at that period and phase on this star.
Not covered: TOIs on neighbouring stars, eclipsing-binary catalogs, CTOIs that are not TOIs, and light-curve tests.
`;
}

export function sourcesText(): string {
  return `# Data sources used by gaussia-mcp

All public and keyless. Every tool names the source it read and when.

| Source | Endpoint | Used by |
|---|---|---|
| ExoFOP TOI table (Caltech/IPAC for NASA) | ${TOI_URL} | toi_lookup, crossmatch_signal |
| NASA Exoplanet Archive, pscomppars (TAP) | ${ARCHIVE_TAP} | crossmatch_signal |
| MAST TIC v8.2 (STScI) | ${MAST_INVOKE} (Mast.Catalogs.Filtered.Tic) | star_info, tess_observations, vet_signal |
| MAST CAOM observations (STScI) | ${MAST_INVOKE} (Mast.Caom.Filtered) | tess_observations |
| MAST TESScut sector lookup (STScI) | ${TESSCUT_URL} | tess_observations |

Credits: ExoFOP (DOI 10.26134/ExoFOP5) and the NASA Exoplanet Archive (DOI 10.26133/NEA13) are operated by the California Institute of Technology under contract with NASA. The TIC (Stassun et al. 2019) and TESS data products are served by MAST at the Space Telescope Science Institute.
`;
}

export function registerResources(server: McpServer): void {
  const md = (uri: URL, body: string) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: body }] });

  server.registerResource(
    "commitment-spec",
    "gaussia://spec/commitment",
    { title: "Blind-matching commitment spec", description: "SPEC.md: the commitment format and the matching rule used by sealed_commit and verify_reveal.", mimeType: "text/markdown" },
    async (uri) => md(uri, packageFile("SPEC.md") ?? "SPEC.md is missing from this install. Read it in the gaussia-mcp repository."),
  );
  server.registerResource(
    "commitment-vectors",
    "gaussia://vectors/commitment",
    { title: "Commitment test vectors", description: "vectors/commitment.json: inputs, ABI encoding and commitment, for other implementations to check against.", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: packageFile("vectors/commitment.json") ?? "{}" }] }),
  );
  server.registerResource(
    "crossmatch-rules",
    "gaussia://rules/crossmatch",
    { title: "Cross-match rules", description: "How crossmatch_signal decides known_planet, known_toi, alias_of_known and no_match, with the current tolerances.", mimeType: "text/markdown" },
    async (uri) => md(uri, crossmatchRules()),
  );
  server.registerResource(
    "sources",
    "gaussia://sources",
    { title: "Data sources and credits", description: "Every public source the tools read, its endpoint, and the credit line it asks for.", mimeType: "text/markdown" },
    async (uri) => md(uri, sourcesText()),
  );

  server.registerPrompt(
    "filter_signal",
    {
      title: "Filter a transit signal",
      description: "The Gaussia Filter step for one signal: cross-match against known objects, run the physical checks, look at TESS coverage, and write a short, honest note.",
      argsSchema: {
        tic_id: z.string().describe("TIC ID of the star."),
        period_days: z.string().describe("Period in days."),
        epoch: z.string().describe("Mid-transit time, BJD_TDB or BTJD."),
        duration_hours: z.string().describe("Transit duration in hours."),
        depth_ppm: z.string().describe("Transit depth in ppm."),
      },
    },
    async (a) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Filter this TESS transit signal for Gaussia: TIC ${a.tic_id}, period ${a.period_days} d, epoch ${a.epoch}, duration ${a.duration_hours} h, depth ${a.depth_ppm} ppm.

1. Call crossmatch_signal with these values. If the verdict is known_planet, known_toi or alias_of_known, stop and say which known object it is; it must not be credited as new.
2. Call vet_signal with the period, duration and depth. Report every flag.
3. Call tess_observations and say which sectors have SPOC 2-min data and which are FFI only.
4. Write a note of at most 120 words: verdict, implied size, flags, coverage, and what a reviewer should look at next.

Rules: use only numbers the tools returned and name their sources. Call it a "signal" or "candidate", never a planet. If a tool fails, say which source failed instead of guessing.`,
          },
        },
      ],
    }),
  );
}
