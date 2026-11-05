# Attempt 2 — browser launch rejected, cause unretained

[Run 41979566755](https://github.com/alvarovillalbaa/tracelet/actions/runs/41979566755),
job 127086293124, 5 November 06:18:52–06:19:28 UTC. Preparation
`4f676c934526ff9ead652394a42d63b840909d98`, activation
`d496598ce971cd9c15c8ab1d1b7d4f942fa4b2e2`.

Static checks, the 81,672-byte source archive, pinned Playwright/Chromium and
xdotool installation passed. B01 and B02 both rejected the persistent-context
launch before service-worker or fixture access; no context was returned. The
driver retained only the first 1,600 error characters, ending in launch
arguments. The precise cause is unobserved. C01 did not execute. These are not
failed application assertions or evidence of an unsupported Chrome feature.

All four full 39-file/source/Git guards matched, and every command leader/group
ended. Context closure was not acknowledged, so both owned profiles and runner
scratch were retained intentionally. Generated output was removed. The receipt
does **not** claim verified cleanup of that residue; platform job teardown is
separate from the driver's own proof. The [JSON](browser-attempt-2.json) retains
all compressed command streams, byte counts and hashes plus actual flags.

Next candidate changes diagnostics: retain error head/tail and full identity,
and leave B02 explicitly unrun when B01 has no returned browser context. No
application code, permission, assertion or cleanup guard is weakened. Earlier
31 local passes and anonymous public delivery remain separate and closed.
