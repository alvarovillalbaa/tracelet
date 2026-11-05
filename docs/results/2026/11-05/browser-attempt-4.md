# Attempt 4 — functional UI complete, cleanup still failed

[Run 41980841278](https://github.com/alvarovillalbaa/tracelet/actions/runs/41980841278),
job 127090327878, 5 November 06:30:18–06:31:44 UTC. Preparation
`c520bf24784777ca26a96f8b87e0602e1cd6d2e2`, activation
`7696b247b9b7d8245b1f8efdae90ea70fbc16fa3`.

Both installed-extension UI journeys completed every functional assertion:
actual chooser/import, edits/save/reload, six actual JSON/Markdown downloads,
transient values omitted, rejected malformed import, confirmed deletion and
empty reload. Narrow saved/empty states both measured scrollWidth 390 against
innerWidth 390. Page errors and unexpected requests were zero. This demonstrates
only those completed operations; **both cases remain failed overall**.

The context-close acknowledgments passed. Cleanup then attempted to read
`/proc/1152/environ` for an unrelated pre-existing runner process and received
EACCES. Profiles and scratch were intentionally retained. All 43-file/source/Git
guards, command groups and generated-output cleanup passed; C01 was unrun.
The [JSON receipt](browser-attempt-4.json) preserves compressed raw streams,
actual download hashes, layout observations and every cleanup flag.

The next candidate respects that permission boundary: do not retry or elevate
the blocked read. Snapshot existing PID/kernel-starttime identities before
launch using stat data only. Later ownership checks inspect new/reused process
identities and skip unchanged pre-existing unrelated processes. A new process
with uncertain ownership still retains the directory and fails. Context closure,
foreground settlement and path identity remain required. No application code or
functional assertion changes.

The shorter path/current runtime allowed these installed workflows to execute;
their simultaneous changes do not isolate the precise earlier SIGTRAP cause.
The original 31 Node passes and public download verification stay separate.
