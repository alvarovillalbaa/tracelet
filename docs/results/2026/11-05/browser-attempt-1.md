# Attempt 1 — checkout ancestry preflight

[Run 41979276665](https://github.com/alvarovillalbaa/tracelet/actions/runs/41979276665),
job 127085350021, 5 November 06:16:12–06:16:24 UTC. Preparation
`231d838aa4c28ded0bef0b148cc408af2f0e51e2`, activation
`582b3d617b4ae065ceeb776bc5605df7b45159eb`.

Node 24.21.0 setup succeeded. The controller stopped at its ancestry preflight:
checkout's default fetch depth one omitted `HEAD^`, and git returned 128.
No static, packaging, installation or browser command executed; all B01/B02/C01
remain unrun. Both after-source/Git guards matched, and empty owned scratch was
removed. Generated output was never created, so its removed flag is false rather
than a claim that a created output was left behind.

The [JSON receipt](browser-attempt-1.json) preserves the exact controller result,
scope and failure. The repair fetches two commits so the existing parent/diff
guard can run. No application code or acceptance assertion changes. The original
31 local passes remain closed. GitHub's Node-20-action-forced-to-24 and setup
punycode warnings remain separate platform/tooling observations.
