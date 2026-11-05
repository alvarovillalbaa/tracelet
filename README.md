# Tracelet

Turn a tab recording into a task you can review and repeat.

A local Chrome extension: record a tab video and timestamped actions, review
and edit the checklist, export the workflow, then replay each approved step
on the original site. No account, subscription, AI call or upload. Built from
Alvaro's [recorder-to-task brief and implementation contract](docs/spec.md).

[31 focused Node checks passed](docs/results/2026/11-05/local-checks.md), followed
by [two installed-extension workspace journeys](docs/results/2026/11-05/browser-attempt-5.md)
covering actual import/edit/save/reload/export/deletion. Capture/replay acceptance
remains separate; it is not implied by the protocol adapters or workspace checks.

[Download and installation](https://tracelet-three.vercel.app) ·
[Source](https://github.com/alvarovillalbaa/tracelet)

## Install

Chrome 116 or later. Download the extension archive from the project site,
unzip it, open `chrome://extensions`, enable **Developer mode**, choose
**Load unpacked** and select the extracted `tracelet` folder. Pin Tracelet
in the toolbar. If Chrome assigns the suggested **Alt+Shift+R** shortcut, you
can use that too; manage or assign it at `chrome://extensions/shortcuts`.
This is a developer installation, not a Chrome Web Store release.

1. Open a website, click Tracelet and choose **Record this tab**. Visible page
   content is recorded: close private information first. No microphone/audio.
2. Perform the task. Use the page stop button or toolbar popup to finish. A
   navigation, five minutes, 100 MiB or 500 actions ends the recording.
3. Review the video and captured actions. Rename/edit the checklist, delete
   unwanted steps, save it, or export JSON/Markdown and the separate WebM video.
4. To repeat a task, open its original page, click Tracelet and choose **Use
   this tab for tasks**. In the workspace, supply any field values and approve
   each step. The result means an event was dispatched; check the website's
   response yourself. Unsupported/sensitive/ambiguous controls remain manual.

## Privacy and limits

Everything stays in this Chrome profile's IndexedDB until you export or delete
it. Video includes visible page content; task editing does not redact video.
Typed field values are not collected and replay values are not saved. There
are no host permissions, network requests, analytics or remote code. Local
browser storage is not encrypted by Tracelet and is not a backup.

Single top-level document only; no frames, cross-page workflow, audio or native
applications. Click/field event processing produces the task checklist: no AI
analysis or invented video understanding. Navigation invalidates replay access.
Every dispatched step needs user approval; website handlers can still have
side effects. Form submissions, links/downloads and sensitive controls are
refused; this cannot guarantee a third-party button has no server effect.

Interrupted captures are labelled partial and retain committed chunks. Browser
storage limits may stop capture early. Export important recordings yourself.
See [architecture](docs/architecture.md), [checks](docs/proposals/focused-checks.md)
and the owning results for verified boundaries. Source implementation and
static hosting do not establish real media/OS permission or store acceptance.

## Development

Node 22+, native modules, no dependencies or application build.

```sh
node scripts/check.mjs
node --experimental-vm-modules --test tests/*.test.mjs
node scripts/package.mjs
git diff --check
```

The packager writes a small reproducible extension ZIP and its integrity file
under `site/downloads/`. Vercel serves `site/` as static files; recordings never
go there. No database or backend deployment is necessary for this local app.

MIT licensed.
