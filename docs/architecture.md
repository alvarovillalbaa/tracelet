# Local recording and deliberate replay

`extension/manifest.json` grants activeTab/scripting/tabCapture/offscreen/storage
without host access. A toolbar popup is the only recording/replay-binding entry
point. The service worker accepts known extension page URLs, or the exact
tab/frame/document/session of an active capture; page messages cannot start
recording or execute a task. No externally_connectable or web-accessible files.

The worker serializes operations and persists its active binding in trusted
Chrome session storage. It uses runtime.getContexts to create one offscreen
USER_MEDIA document. Chrome 116+ stream IDs are consumed there using video-only
getUserMedia and MediaRecorder. The offscreen document writes Blob chunks into
IndexedDB, not Chrome's JSON message channel. One transaction updates chunk
identity and byte totals; separate atomic metadata updates retain concurrent
actions. Media finalization waits for the final data and committed chunks before
stopping/closing tracks and opening the workspace. Quota/encoding interruption
produces a partial result rather than a success claim.

`content.js` runs only in the isolated top frame, captures trusted events and
describes unique targets. Field values are absent. A document-bound stop control
and toolbar badge make capture visible. Pagehide/navigation/tab removal closes
the capture. Session storage does not grant permission to a new document.

The strict workflow DTO has no executable code or saved parameter values.
Workspace text uses DOM text/value properties; JSON, Markdown and WebM downloads
are explicit. IndexedDB is shared by extension pages only. Editing a session
cannot overwrite active capture metadata; deletion removes its chunks in the
same transaction. Existing complete video metadata is retained on task edits.

Replay resolves the current saved step rather than accepting a caller's code or
selector. It requires a fresh toolbar-bound document and identical origin/path,
then the content bridge repeats descriptor, uniqueness, visibility, enabled,
sensitivity and action checks immediately before dispatch. Values live only in
the review page's memory. No batch, retry, page-script evaluation or navigation.
An acknowledged dispatch is not an observed website transaction result.

## Primary references

Inspected 5 November 2026. Chrome's official guidance supports stream-ID capture
in a worker and consumption in an offscreen document from Chrome 116, requires
runtime messaging for offscreen extension APIs, and describes activeTab's
temporary user-invoked grant. This source uses chrome.*, not the newer browser.*
alias shown in current documentation, to retain the declared minimum version.

- [Capture and offscreen](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- [Offscreen lifecycle](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Message serialization](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#serialization)
- [Worker persistence](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#persist-data-rather-than-using-global-variables)

Actual extension, capture, file/reload and replay acceptance must be recorded
separately from authored pure/protocol tests. Store distribution and native Mac
support are not part of this implementation. No credentials or account are used.
