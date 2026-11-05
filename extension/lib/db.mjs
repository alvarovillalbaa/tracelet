import { toWorkflow } from './workflow.mjs';

const NAME = 'tracelet-local-v1';
export const MAX_BYTES = 100 * 1024 * 1024;
let opening;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('sessions', { keyPath: 'id' });
      const chunks = db.createObjectStore('chunks', { keyPath: ['sessionId', 'sequence'] });
      chunks.createIndex('sessionId', 'sessionId');
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new Error('Close other Tracelet windows and try again.')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  });
  return opening;
}

async function read(store, key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    let result;
    request.onsuccess = () => { result = request.result ?? null; };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Local storage could not be read.'));
  });
}

export function getSession(id) { return read('sessions', id); }

export async function listSessions() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const request = tx.objectStore('sessions').getAll();
    let rows = [];
    request.onsuccess = () => { rows = request.result; };
    tx.oncomplete = () => resolve(rows.sort((a, b) => b.createdAt - a.createdAt));
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Local library could not be read.'));
  });
}

// A read/modify/write runs inside one transaction, so chunk/event writers cannot
// overwrite one another even when the service worker has restarted.
export async function updateSession(id, transform) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const request = store.get(id);
    let result, failure;
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('Recording no longer exists.');
        result = transform(request.result);
        if (!result || result.id !== id) throw new Error('Invalid recording update.');
        result = { ...result, revision: (request.result.revision ?? 0) + 1 };
        store.put(result);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Recording could not be saved.'));
  });
}

export async function createSession(session) {
  const db = await open();
  session = { ...session, revision: 0 };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').add(session);
    tx.oncomplete = () => resolve(session);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Recording could not be created.'));
  });
}

export async function saveSession(session) {
  const workflow = toWorkflow(session);
  const existing = await getSession(session.id);
  if (existing) return updateSession(session.id, current => {
    if (current.status === 'recording') throw new Error('Stop recording before editing tasks.');
    if (session.revision !== current.revision) throw new Error('Another window changed this task. Reopen it before saving.');
    return { ...current, title: workflow.title, source: workflow.source, steps: workflow.steps };
  });
  const startedAt = Date.now();
  return createSession({
    id: typeof session.id === 'string' && /^[0-9a-f-]{36}$/i.test(session.id) ? session.id : crypto.randomUUID(),
    ...workflow, createdAt: startedAt, startedAt,
    stoppedAt: startedAt + (workflow.steps.at(-1)?.at ?? 0), status: 'workflow', reason: 'Imported task workflow; no video.', byteLength: 0, mimeType: ''
  });
}

export async function addChunk(sessionId, sequence, blob) {
  if (!(blob instanceof Blob) || !Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid video chunk.');
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
    const sessions = tx.objectStore('sessions');
    const request = sessions.get(sessionId);
    let failure;
    request.onsuccess = () => {
      try {
        const session = request.result;
        if (!session || session.status !== 'recording') throw new Error('Recording is no longer writable.');
        if (session.byteLength + blob.size > MAX_BYTES) throw new Error('The 100 MiB recording limit was reached.');
        tx.objectStore('chunks').add({ sessionId, sequence, blob });
        sessions.put({ ...session, byteLength: session.byteLength + blob.size, mimeType: blob.type || session.mimeType, revision: (session.revision ?? 0) + 1 });
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Video could not be saved. Storage may be full.'));
  });
}

export async function getVideo(id) {
  const session = await getSession(id);
  if (!session) return null;
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const request = tx.objectStore('chunks').index('sessionId').getAll(id);
    let chunks = [];
    request.onsuccess = () => { chunks = request.result; };
    tx.oncomplete = () => resolve(chunks.length ? new Blob(chunks.sort((a, b) => a.sequence - b.sequence).map(x => x.blob), { type: session.mimeType || 'video/webm' }) : null);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Video could not be read.'));
  });
}

export async function deleteSession(id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
    const sessions = tx.objectStore('sessions');
    const request = sessions.get(id);
    let failure;
    request.onsuccess = () => {
      if (request.result?.status === 'recording') { failure = new Error('Stop this recording before deleting it.'); tx.abort(); return; }
      sessions.delete(id);
      const cursor = tx.objectStore('chunks').index('sessionId').openCursor(id);
      cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Recording could not be deleted.'));
  });
}
