# Focused workflow checks

Prepared 5 November 2026 under the owner's standing “approve everything / keep
going / do all the work” instruction. The initial packet subsequently passed
once; see the [owning result](../results/2026/11-05/local-checks.md).
It introduces no dependency or account. The [product contract](../spec.md)
remains the source of the extension's capture, privacy and replay boundaries.

The local packet is one existing-Node invocation of
`node --experimental-vm-modules --test tests/*.test.mjs`, with exactly 31 authored cases and no
retry. Record the immutable source, existing Node version/binary hash, exact
actual names/statuses, bounded complete stdout/stderr and exit code. Supervise
the process group with a 120-second work cap, 128 KiB per stream and bounded
TERM/KILL/drain/reaping. Use an empty owned temporary directory; verify all
source paths, modes and bytes before/after, remove only owned residue and
preserve the first actual failure before any repair or rerun. No install,
browser, app build, account, provider, model or network call belongs to this
packet. The Storage Guard failure remains in force for heavy local work.

The 25 cases cover strict versioned data and required/unknown keys, non-plain
objects/accessors, non-executable recovery projection, duplicate identities,
event order/five-minute and 500-step caps, bounded text/valid Unicode, sensitive
field controls, canonical private-source stripping, Markdown escaping,
deterministic duration/counts, finalization time beyond the capped action
timeline and JSON round trips. They import only the pure
workflow module and Node's standard library. Test data is authored and has no
recording, credentials or user content. Six additional cases evaluate the actual
offscreen source with Node's experimental VM modules and explicit authored
Chrome/MediaRecorder/IndexedDB adapters: final chunk commit before status/reply,
quota failure and retained prefix, sender refusal, concurrent acquisition,
unsupported encoder cleanup and idempotent duplicate stop. These adapters do
not exercise real browser media or database APIs. Experimental VM warnings are
retained in stderr. The acquisition latch repairs a source-inspected concurrent
start race; no prior executed failure is implied.

Separately, `node scripts/check.mjs` parses JS/MJS with `node --check`, parses
JSON, inventories local imports and HTML assets, and verifies MV3 permissions
and the extension's local-only CSP. It never imports extension modules or calls
product functions. The generated extension archive is checked by packaging,
not assumed to exist before that step. Passing static checks is not a test
pass, an extension installation or browser acceptance.

The actual Chrome boundary remains subsequent work: load the exact extension,
explicitly record an authored tab, stop and reopen the local video/session,
review/edit/export/import, recover an interrupted recording and approve one
replay step at a time. A temporary Chromium protocol check can establish only
the APIs and fixtures it actually exercises; it cannot stand in for genuine
tabCapture, visible-content consent, permission/device behavior or store
distribution. No Chrome Web Store enrollment or submission is included.
