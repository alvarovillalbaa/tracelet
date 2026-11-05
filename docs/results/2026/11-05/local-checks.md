# Initial workflow and recorder protocol checks

5 November 2026, 06:04–06:05 UTC. **31 cases passed once**, with no failure,
cancellation, skip or TODO, on existing Node **26.8.2**. The exact 31 authored
names match the unique checkmarked SPEC-reporter results, independently reviewed.
Node 26 selected the SPEC reporter rather than TAP: an initial reviewer TAP
regular expression returned zero names, without invalidating the actual run.
No rerun occurred. The experimental VM warning is retained in stdout; stderr
is empty. All raw stream bytes, binary fingerprint, command and exit evidence
are in the [JSON receipt](local-checks.json).

The 25 pure workflow cases verify strict imports, private URL normalization,
limits, detached/non-executable DTOs, counts, duration and Markdown/JSON exports.
Six recorder cases execute actual offscreen source against explicitly authored
media/storage/Chrome adapters. They verify final chunk commit before completion,
partial writes, sender refusal, concurrent-start refusal, unsupported encoding
cleanup and duplicate-stop idempotency. These are protocol adapters, not actual
IndexedDB, browser permissions, video encoding or website replay acceptance.

The 120-second/128-KiB-per-stream supervisor observed exit zero, both stream EOFs,
reaped leader and absent original process group. All **29 source files / 145,773
bytes** remained exact before/after. Its owned scratch was removed. Raw output
was 3,137 bytes, SHA-256 `c58fadcf7e534771b6c41c6f6c2408800ed51cf6bb3c763fab1860809e1e26c0`.
The publication omits only the machine-local executable path; its raw receipt
SHA and preserved Node binary hash make that derivation explicit. No local
environment or dependency was installed.

Source review before execution repaired a concurrent offscreen-start race,
SPA navigation stop ownership and stale reviewed-step comparison. No executed
pre-repair failure is claimed. The later manifest adds an Alt+Shift+R toolbar
shortcut; README and acceptance tooling were added/edited after this sealed
edition. The pure module, offscreen code and both tested files retain their
checked bytes. Browser and full-product acceptance remain separate.
