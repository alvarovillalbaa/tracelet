# Tracelet initial developer delivery

5 November 2026. New dedicated
[personal repository](https://github.com/alvarovillalbaa/tracelet) and public
[installation/privacy/download site](https://tracelet-three.vercel.app).
The selected Chrome-first interpretation of the recorder-to-task brief is
explicit in the [owning contract](../../../spec.md); Framelet remains separate.

Implemented: explicit video-only tab recording, timestamped value-free actions,
local IndexedDB/chunks, interrupted-session recovery, review/edit/save/delete,
strict workflow import, real JSON/Markdown/WebM downloads and individually
approved same-document replay. No account, shared backend, model/provider,
analytics or paid service is configured. Typed replay parameters stay ephemeral;
visible private information can still appear in video. App/UI/worker/storage
and source archive are in this repository, with no application dependencies.

Three distinct scopes passed, at their actual sources and runtimes:

- [31 Node workflow/recorder-adapter cases](local-checks.md), existing Node 26.8.2.
- [B01/B02 installed workspace journeys](browser-attempt-5.md), Node 24.21.0 /
  Playwright 1.64.1; actual import/edit/reload/download/delete and narrow layout.
- [C01 genuine tabCapture/MediaRecorder/replay](capture-checks.md), same tooling /
  Chromium 156.0.8078.4 under Xvfb. A short real WebM decoded/played/downloaded;
  edits survived reload and two separately approved actions changed the fixture.

No scope was rerun after acceptance. Eight earlier attempts remain immutable,
including unverified failed-run residue and unknown precise trap/editor causes.
Successful later cleanup supplies no retroactive proof for those failures.

Initial source `231d838aa4c28ded0bef0b148cc408af2f0e51e2` was published and
production `dpl_SEr8B6qdkPQifUzkJFKDDt6wvCCT` reported READY. Between 06:16:27
and 06:18:14 UTC, anonymous root/integrity/ZIP GETs returned 200. Root bytes
matched source (3,609 bytes, SHA-256
`d9663c148ee3605176ec6a97e9994f75731097784c50b92269050334331d3c26`);
the original 81,672-byte twelve-file ZIP was source-exact, CRC-valid and SHA-256
`b98a549d125504d7c3f7397e28472efe0b02b60a33fce5bc6f62615a64ec6c2f`.
Latest source/deployment/public-artifact observations belong in the separate
publication receipt, not relabeled as that initial HTTP observation.

The final packaging edition includes the MIT license alongside the **unchanged
twelve extension files**. Its 13-member ZIP is 82,852 bytes, SHA-256
`992bf5e22d0da491bda85b05d298781bd3fa1c1a08b0eada8cbf116defde7e89`.
Static packaging/CRC/member comparisons establish this addition; C01's actual
checked archive remains the earlier twelve-file edition. No browser rerun or
fresh-install equivalence is implied by a metadata/license addition.

This is a load-unpacked developer release. Chrome Web Store distribution,
macOS/physical-device, human download/install, five-minute/quota/stress,
cross-document and general third-party-site behavior remain unverified or
outside this first contract. Replay dispatch cannot establish a third-party
transaction's safety. The full portfolio remains active and unfinished; the
four non-priority apps stay deferred. No local browser environment was installed:
Storage Guard measured 20.0 GiB free against 34.0 required; only bounded source,
static checks and the sub-100-KiB source archive used local storage.
