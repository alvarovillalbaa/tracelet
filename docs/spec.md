# Recorder to task

Decision: 5 November 2026. Product intent comes from the personal
[Notion portfolio](https://app.notion.com/p/311a1ee8bd06805caa21c5306dd315ac):
record the screen, save/process/analyze it, then allow users to automate it.
The connector returned the 3 November 23:13:27 UTC snapshot on 5 November;
the page is unverified and omits three unrelated blocks. This New entry is
present in full, with no attached child brief. It originally questioned Chrome
versus Mac. The owner's later “you choose / do all the work” authorizes this
explicit implementation choice: a Chrome extension called **Tracelet**.

## First useful product

1. The toolbar popup explains that visible tab content will be recorded. The
   user explicitly starts video-only recording of that current HTTP(S) tab.
   No microphone, sound, other tabs or desktop capture. A badge and in-page
   indicator stay visible, with a stop control. Maximum 5 minutes / 100 MiB /
   500 actions; navigation ends this single-document recording.
2. Record top-frame trusted clicks and field changes alongside the video.
   Keep timestamp, bounded target description and a unique CSS selector.
   Field values are never collected. Password/OTP/payment/hidden/file controls
   and sensitive forms are excluded. Unsupported targets stay manual.
3. Store sessions and video chunks locally in IndexedDB. A completed recording
   can be reopened, played, renamed, reviewed, edited or deleted. Interrupted
   sessions remain recoverable as partial recordings; no completeness claim.
4. Process captured actions into an editable ordered checklist. Report actual
   duration, click/field/manual counts and missing parameters. Export versioned
   workflow JSON or Markdown tasks; download the video separately. This is
   deterministic processing of browser events, not AI/visual understanding.
5. Import strict, bounded workflow JSON without replacing current work on
   invalid input. Imported workflows contain no executable code. Select the
   original site tab through a fresh toolbar action. Before replay, show the
   site, current target and operation. Each step needs its own explicit click.
   Field values are supplied at replay, held only in the workspace and never
   recorded or saved. Resolve a single visible/enabled element and verify its
   original tag/type/label. Refuse changed/ambiguous/hidden/disabled/sensitive
   targets, other origins/paths, frames and form submissions. Navigation ends
   the replay binding. No automatic batch, arbitrary JS, native input, remote
   automation or claim of transaction safety on a third-party site.

Chrome 116+ Manifest V3. Native modules, no package installation or application
build. Extension APIs use chrome.* for compatibility; offscreen owns media
and IndexedDB chunks, service worker validates messages and current tab binding.
Manifest permissions: activeTab, scripting, tabCapture, offscreen, storage.
No host permissions or web-accessible resources. Ordinary links/downloads are
user initiated in the extension workspace; no downloads permission needed.

## Delivery boundaries

Dedicated personal GitHub repo, load-unpacked extension archive and public
installation/privacy page. Vercel hosts only the static page/artifact, never
recordings. No Supabase backend is necessary for the explicitly local product.
No new accounts, paid plan, Chrome Web Store registration or submission.
Real browser media capture, lifecycle/reload/replay and file acceptance must
be observed separately before claiming the whole flow accepted. Scripted
protocol tests cannot replace the operating system/browser permission boundary.

Primary API references inspected on 5 November:

- [Chrome capture/offscreen pattern](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- [Offscreen document lifecycle](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Temporary activeTab access](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

The unspecified VS Code extension remains undefined; no behavior is invented
for it. Existing four non-priority apps stay deferred.
