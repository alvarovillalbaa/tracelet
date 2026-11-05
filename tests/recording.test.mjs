import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sourceURL = new URL('../extension/offscreen.mjs', import.meta.url);
const trusted = { id: 'tracelet-test-extension', url: 'chrome-extension://tracelet-test-extension/worker.mjs' };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate) {
  for (let index = 0; index < 20; index++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('The finite protocol checkpoint was not reached.');
}

// The production module is evaluated unchanged. Only browser media, extension
// messaging and the transactional-storage boundary are authored test doubles.
async function recorderHarness(options = {}) {
  const rows = new Map(['first', 'second'].map(id => [id, { id, status: 'recording', byteLength: 0, stoppedAt: null }]));
  const chunks = [], log = [], notifications = [], recorders = [], mediaRequests = [], timers = new Map();
  let listener, timerId = 0;
  const track = {
    stopCalls: 0, listeners: new Map(),
    stop() { this.stopCalls++; log.push('track-stopped'); },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  class MediaRecorder {
    static isTypeSupported() { return !options.unsupportedMime; }
    constructor(actualStream, configuration) {
      assert.equal(actualStream, stream);
      this.configuration = configuration;
      this.state = 'inactive'; this.stopCalls = 0;
      recorders.push(this);
    }
    start(timeslice) {
      assert.equal(timeslice, 1000);
      this.state = 'recording'; log.push('recorder-started');
    }
    data(value) {
      log.push('data-available');
      this.ondataavailable?.({ data: new Blob([value], { type: 'video/webm' }) });
    }
    stop() {
      assert.notEqual(this.state, 'inactive');
      this.stopCalls++; this.state = 'inactive'; log.push('recorder-stop-requested');
      queueMicrotask(() => {
        if (options.finalChunk) this.data(options.finalChunk);
        this.onstop?.();
      });
    }
  }
  const dbFunctions = {
    async getSession(id) { return structuredClone(rows.get(id) ?? null); },
    async addChunk(id, sequence, blob) {
      log.push(`chunk-begin:${sequence}`);
      if (options.chunkGate) await options.chunkGate.promise;
      if (options.failSequence === sequence) { log.push(`chunk-refused:${sequence}`); throw new Error('Authored storage quota refusal.'); }
      const bytes = Buffer.from(await blob.arrayBuffer());
      chunks.push({ id, sequence, bytes });
      const row = rows.get(id);
      rows.set(id, { ...row, byteLength: row.byteLength + bytes.length });
      log.push(`chunk-committed:${sequence}`);
    },
    async updateSession(id, transform) {
      const next = transform(structuredClone(rows.get(id)));
      rows.set(id, structuredClone(next)); log.push(`status:${next.status}`);
      return structuredClone(next);
    },
  };
  const context = vm.createContext({
    Blob, Date, Promise, queueMicrotask,
    setTimeout(callback, milliseconds) { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
    navigator: { mediaDevices: { async getUserMedia(configuration) {
      mediaRequests.push(structuredClone(configuration)); log.push('media-requested');
      if (options.mediaGate) await options.mediaGate.promise;
      return stream;
    } } },
    MediaRecorder,
    chrome: { runtime: {
      id: trusted.id,
      onMessage: { addListener(callback) { assert.equal(listener, undefined); listener = callback; } },
      async sendMessage(message) { notifications.push(structuredClone(message)); log.push('completion-notified'); return { ok: true }; },
    } },
  });
  const db = new vm.SyntheticModule(Object.keys(dbFunctions), function () {
    for (const [name, value] of Object.entries(dbFunctions)) this.setExport(name, value);
  }, { context });
  const module = new vm.SourceTextModule(await readFile(sourceURL, 'utf8'), { context, identifier: sourceURL.href });
  await module.link(specifier => { assert.equal(specifier, './lib/db.mjs'); return db; });
  await module.evaluate();
  function request(type, data = {}, sender = trusted) {
    return new Promise(resolve => {
      const kept = listener({ target: 'offscreen', type, ...data }, sender, result => resolve(structuredClone(result)));
      if (kept !== true) resolve(null);
    });
  }
  return { rows, chunks, log, notifications, recorders, mediaRequests, timers, track, request };
}

test('final video data is committed before completed metadata and the stop reply', { timeout: 2000 }, async () => {
  const gate = deferred();
  const h = await recorderHarness({ finalChunk: 'actual-final-chunk', chunkGate: gate });
  assert.equal((await h.request('start', { sessionId: 'first', streamId: 'authored-stream' })).ok, true);
  assert.equal(h.mediaRequests[0].audio, false);
  assert.equal(h.mediaRequests[0].video.mandatory.chromeMediaSourceId, 'authored-stream');
  let replied = false;
  const stopping = h.request('stop', { reason: 'Authored explicit stop.' }).then(result => { replied = true; return result; });
  await until(() => h.log.includes('chunk-begin:0'));
  assert.equal(replied, false);
  assert.equal(h.rows.get('first').status, 'recording');
  assert.equal(h.notifications.length, 0);
  assert.ok(h.log.indexOf('data-available') < h.log.indexOf('track-stopped'));
  gate.resolve();
  const reply = await stopping;
  assert.equal(reply.ok, true); assert.equal(reply.error, undefined);
  assert.equal(h.chunks.length, 1); assert.equal(h.chunks[0].bytes.toString(), 'actual-final-chunk');
  assert.ok(h.log.indexOf('chunk-committed:0') < h.log.indexOf('status:complete'));
  assert.equal(h.rows.get('first').status, 'complete');
  assert.equal(h.rows.get('first').reason, 'Authored explicit stop.');
  assert.equal(h.track.stopCalls, 1); assert.equal(h.timers.size, 0);
  assert.equal(h.notifications.length, 1);
  assert.equal((await h.request('status')).sessionId, null);
});

test('a refused video write preserves committed chunks and finalizes as partial with no live track', { timeout: 2000 }, async () => {
  const h = await recorderHarness({ failSequence: 1 });
  assert.equal((await h.request('start', { sessionId: 'first', streamId: 'authored-stream' })).ok, true);
  h.recorders[0].data('kept-prefix');
  await until(() => h.chunks.length === 1);
  h.recorders[0].data('refused-chunk');
  await until(() => h.rows.get('first').status === 'partial');
  assert.deepEqual(h.chunks.map(chunk => chunk.bytes.toString()), ['kept-prefix']);
  assert.match(h.rows.get('first').reason, /quota refusal/);
  assert.equal(h.log.includes('status:complete'), false);
  assert.equal(h.recorders[0].stopCalls, 1); assert.equal(h.track.stopCalls, 1);
  assert.equal(h.timers.size, 0); assert.equal(h.notifications.length, 1);
  assert.equal((await h.request('status')).sessionId, null);
});

test('foreign extension and tab senders cannot start or stop the offscreen recorder', { timeout: 2000 }, async () => {
  const h = await recorderHarness();
  for (const sender of [{ id: 'another-extension' }, { ...trusted, tab: { id: 17 } }, {}]) {
    assert.equal(await h.request('start', { sessionId: 'first', streamId: 'not-authorized' }, sender), null);
    assert.equal(await h.request('stop', {}, sender), null);
  }
  assert.equal(h.mediaRequests.length, 0); assert.equal(h.recorders.length, 0);
  assert.equal(h.notifications.length, 0); assert.equal(h.track.stopCalls, 0);
  assert.equal(h.rows.get('first').status, 'recording');
});

test('a second start is refused while the first media acquisition is still pending', { timeout: 2000 }, async () => {
  const mediaGate = deferred();
  const h = await recorderHarness({ mediaGate });
  const first = h.request('start', { sessionId: 'first', streamId: 'first-stream' });
  await until(() => h.mediaRequests.length === 1);
  const second = h.request('start', { sessionId: 'second', streamId: 'second-stream' });
  let secondReply;
  void second.then(result => { secondReply = result; });
  // Releasing in finally ensures an assertion failure never leaves the authored
  // media promise pending; every recorder actually created is stopped below.
  try {
    await until(() => secondReply !== undefined);
    assert.equal(secondReply.ok, false); assert.match(secondReply.error, /active|starting|progress/i);
    assert.equal(h.mediaRequests.length, 1);
  } finally {
    mediaGate.resolve();
    await Promise.all([first, second]);
    await h.request('stop');
    for (const recorder of h.recorders) if (recorder.state !== 'inactive') recorder.stop();
  }
  assert.equal(h.recorders.length, 1); assert.equal(h.track.stopCalls, 1);
  assert.equal(h.rows.get('second').status, 'recording');
});

test('unsupported encoding releases an acquired stream without inventing completed metadata', { timeout: 2000 }, async () => {
  const h = await recorderHarness({ unsupportedMime: true });
  const result = await h.request('start', { sessionId: 'first', streamId: 'authored-stream' });
  assert.equal(result.ok, false); assert.match(result.error, /WebM|encode/);
  assert.equal(h.mediaRequests.length, 1); assert.equal(h.track.stopCalls, 1);
  assert.equal(h.recorders.length, 0); assert.equal(h.chunks.length, 0);
  assert.equal(h.rows.get('first').status, 'recording');
  assert.equal(h.notifications.length, 0); assert.equal(h.timers.size, 0);
  assert.equal((await h.request('status')).sessionId, null);
});

test('repeated stop requests share finalization and cannot duplicate its terminal receipt', { timeout: 2000 }, async () => {
  const gate = deferred();
  const h = await recorderHarness({ finalChunk: 'one-tail', chunkGate: gate });
  await h.request('start', { sessionId: 'first', streamId: 'authored-stream' });
  const first = h.request('stop', { reason: 'First deliberate stop.' });
  const second = h.request('stop', { reason: 'Repeated stop.' });
  await until(() => h.log.includes('chunk-begin:0'));
  assert.equal(h.recorders[0].stopCalls, 1); assert.equal(h.notifications.length, 0);
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true); assert.deepEqual(a, b);
  assert.equal(h.chunks.length, 1); assert.equal(h.track.stopCalls, 1);
  assert.equal(h.rows.get('first').reason, 'First deliberate stop.');
  assert.equal(h.log.filter(row => row === 'status:complete').length, 1);
  assert.equal(h.notifications.length, 1); assert.equal(h.timers.size, 0);
  assert.equal((await h.request('status')).sessionId, null);
});
