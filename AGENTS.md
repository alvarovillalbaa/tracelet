# Tracelet

Owner: Alvaro. This is the dedicated recorder-to-task Chrome extension from the
personal Notion portfolio, separate from Framelet's native video editor.

- The owner's standing “you choose / approve everything / keep going / do all
  the work” resolves the earlier platform choice: Chrome first. Root selected
  the concrete local recording/action/review/replay contract in `docs/spec.md`.
- Read `docs/spec.md` before changes. Preserve local-only storage, explicit
  capture, bounded recordings, parameterized fields and one approved replay
  step at a time. Never imply that action processing analyzes video with AI.
- No host permissions, external connections, analytics, model/provider, account
  or paid service. `activeTab` is acquired by clicking the toolbar action.
- No password, payment, OTP or text field values collected from the page. Video
  contains visible page content: the UI must say so. Do not claim video redaction.
- All imported/recorded text renders through textContent or form values. Never
  evaluate imported scripts, use HTML sinks or weaken sender/origin checks.
- Manual edits use apply_patch. Preserve others' work and historical evidence.
- Focused Node checks and temporary public Chromium CI are authorized by the
  owner's standing approval. Keep exact sources, runtime and proof limits. An
  extension protocol test is not genuine tabCapture/device/store acceptance.
- The initial 31 Node cases passed once on existing Node 26.8.2; the exact
  source and bounded raw receipt are in `docs/results/2026/11-05/local-checks.md`.
  Keep that scope closed. Later installed-extension/capture execution has its
  own preparation and receipt rather than relabeling the Node adapters.
- Source and personal GitHub publication and free static Vercel hosting are
  authorized. No store enrollment/submission or paid resource is authorized.
- No local installs/builds/browser environments: Storage Guard on 5 November
  measured 20.0 GiB free versus 34.0 required. Source/static work stays small;
  any external test environment is task-owned and removed after its run.
