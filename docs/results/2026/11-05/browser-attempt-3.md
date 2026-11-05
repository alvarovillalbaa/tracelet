# Attempt 3 — Chromium SIGTRAP and harness repair

[Run 41980142441](https://github.com/alvarovillalbaa/tracelet/actions/runs/41980142441),
job 127088110103, 5 November 06:24:00–06:24:36 UTC. Preparation
`4f11e0ebf038b91953d5eaafa18e9edb71a7bea0`, activation
`08ece4e80459742ded2240b9685813e1f593d494`.

B01's Chromium 145 process exited with SIGTRAP before returning a context.
The full 4,908-byte error identity and sanitized untruncated text are retained
in the [JSON](browser-attempt-3.json). Missing CPU-frequency Crashpad reads
appear in the log; they do not prove the cause of the trap. B02 was left unrun
without repeating the launch; C01 was unrun. Source/Git guards, command groups
and generated-output cleanup passed. The unacknowledged browser profile and
runner scratch remained intentionally retained, with cleanup unverified.

Inspection identified a separate concrete harness defect: the actual browser
TMPDIR was 68 bytes before Chromium's temporary-directory and SingletonSocket
suffix. [Chromium's source](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/process_singleton_posix.cc)
checks the full Unix socket path and fatals at the platform limit. The next
candidate uses a short, private, task-owned `/tmp/tl-*` root plus a conservative
prelaunch byte-budget assertion. All identity/process/deletion guards remain.

The external tooling also moves from stale Playwright 1.58.2 to independently
verified current 1.64.1/bundled Chromium, following the maintainer's
[current-bundled-browser guidance](https://github.com/microsoft/playwright-java/issues/1871)
and the [extension guide](https://playwright.dev/docs/chrome-extensions).
This is a new runtime profile with two harness changes, not an isolated proof
of the old trap's cause. No product code, acceptance assertion, permission or
application dependency changes. The earlier local 31 cases remain closed.
