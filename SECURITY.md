# Security

Please report vulnerabilities privately to **core@gaussia.app**. Do not open a public issue.

Include what you found, how to reproduce it and what it affects. We will reply within a few days.

In scope:

- A tool sending data anywhere other than the public sources it names (ExoFOP, NASA Exoplanet Archive, MAST).
- A tool returning data that did not come from those sources, or hiding that a source failed.
- A crafted input that crashes or hangs the server.

The server reads no files, writes nothing to disk, needs no keys and holds no secrets.
