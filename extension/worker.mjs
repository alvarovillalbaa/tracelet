import { createSession, getSession, listSessions, updateSession } from './lib/db.mjs';
import { safeSource, validateStep } from './lib/workflow.mjs';

const offscreenURL = chrome.runtime.getURL('offscreen.html');
const uiURLs = ['popup.html', 'workspace.html'].map(path => chrome.runtime.getURL(path));
let operations = Promise.resolve();
let creating;
const serial = action => {
  const next = operations.then(action);
  operations = next.catch(() => {});
  return next;
};
const sameSource = (a, b) => a?.origin === b?.origin && a?.path === b?.path;
const sendRecorder = data => chrome.runtime.sendMessage({ target: 'offscreen', ...data });

async function state() { return (await chrome.storage.session.get(['active', 'binding'])); }
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenURL] });
  if (contexts.length) return;
  if (!creating) creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Save the tab video explicitly requested in Tracelet.' }).finally(() => { creating = null; });
  await creating;
}
async function openLibrary(sessionId) {
  await chrome.tabs.create({ url: chrome.runtime.getURL('workspace.html') + (sessionId ? `?session=${encodeURIComponent(sessionId)}` : '') });
}
async function badge(recording) {
  await chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  if (recording) await chrome.action.setBadgeBackgroundColor({ color: '#b93220' });
}
async function recover() {
  let recorder;
  try { recorder = await sendRecorder({ type: 'status' }); } catch { /* No document exists after a browser restart. */ }
  const runningId = recorder?.sessionId;
  for (const row of await listSessions()) if (row.status === 'recording' && row.id !== runningId) {
    await updateSession(row.id, current => ({ ...current, status: 'partial', stoppedAt: Date.now(), reason: 'Recording was interrupted. Only committed video chunks and actions were recovered.' }));
  }
  const saved = await state();
  if (saved.active && saved.active.sessionId !== runningId) await chrome.storage.session.remove('active');
  await badge(Boolean(runningId));
}

async function inject(tabId) {
  const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content.js'], world: 'ISOLATED' });
  const result = results.find(row => row.frameId === 0);
  if (!result?.documentId) throw new Error('This tab cannot be bound to Tracelet.');
  return result.documentId;
}
async function stop(reason = 'Stopped by you.', partial = false) {
  const { active } = await state();
  if (!active) return { ok: true };
  let failure;
  try {
    try { await chrome.tabs.sendMessage(active.tabId, { target: 'content', type: 'stop' }, { documentId: active.documentId }); } catch { /* The original document may have gone away. */ }
    let result;
    try { result = await sendRecorder({ type: 'stop', reason, partial }); } catch { /* Recovery below keeps committed data. */ }
    const row = await getSession(active.sessionId);
    if (row?.status === 'recording') await updateSession(row.id, current => ({ ...current, status: 'partial', stoppedAt: Date.now(), reason: result?.error || 'Recording was interrupted before finalization.' }));
    if (result?.error) failure = result.error;
  } catch { failure = 'Recording stopped, but its final status could not be saved. Reopen the library to recover committed data.'; }
  finally {
    await chrome.storage.session.remove('active');
    await badge(false);
    try { await chrome.offscreen.closeDocument(); } catch { /* Already closed. */ }
    await openLibrary(active.sessionId);
  }
  return { ok: !failure, sessionId: active.sessionId, ...(failure ? { error: failure } : {}) };
}

async function start(tabId) {
  await recover();
  if ((await state()).active) throw new Error('Stop the current recording first.');
  if (!Number.isInteger(tabId)) throw new Error('Choose a website tab first.');
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) throw new Error('Start from the active website tab.');
  const source = safeSource(tab.url);
  const documentId = await inject(tabId);
  const id = crypto.randomUUID(), startedAt = Date.now();
  const session = { id, title: (tab.title || 'Untitled recording').slice(0, 120), source,
    createdAt: startedAt, startedAt, stoppedAt: null, status: 'recording',
    steps: [], reason: '', byteLength: 0, mimeType: 'video/webm' };
  await createSession(session);
  const active = { sessionId: id, tabId, documentId, source, startedAt };
  await chrome.storage.session.set({ active });
  try {
    await ensureOffscreen();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    const result = await sendRecorder({ type: 'start', sessionId: id, streamId });
    if (!result?.ok) throw new Error(result?.error || 'Chrome could not start recording.');
    const ready = await chrome.tabs.sendMessage(tabId, { target: 'content', type: 'start', sessionId: id, startedAt, source }, { documentId });
    if (!ready?.ok) throw new Error(ready?.error || 'The page cannot record actions.');
    await badge(true);
    return { ok: true, sessionId: id };
  } catch (error) {
    await stop(error.message, true);
    throw error;
  }
}

async function bind(tabId) {
  if ((await state()).active) throw new Error('Stop recording before replaying a task.');
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) throw new Error('Choose the active website tab.');
  const source = safeSource(tab.url);
  const documentId = await inject(tabId);
  await chrome.storage.session.set({ binding: { tabId, documentId, source } });
  await openLibrary();
  return { ok: true };
}

async function execute(message) {
  const { active, binding } = await state();
  if (active) throw new Error('Stop recording before replaying a task.');
  if (!binding) throw new Error('Open the original site, click Tracelet and choose “Use this tab for tasks”.');
  const session = await getSession(message.sessionId);
  const step = session?.steps?.find(row => row.id === message.stepId);
  if (!step || !sameSource(binding.source, session.source)) throw new Error('This task belongs to a different site or page.');
  if (JSON.stringify(validateStep(step)) !== JSON.stringify(validateStep(message.expectedStep))) throw new Error('This step changed after you reviewed it. Reload and review it again.');
  const tab = await chrome.tabs.get(binding.tabId);
  if (!sameSource(safeSource(tab.url), binding.source)) throw new Error('The selected tab has changed. Choose it again.');
  if (message.value != null && (typeof message.value !== 'string' || message.value.length > 4000)) throw new Error('Enter a value of at most 4,000 characters.');
  const result = await chrome.tabs.sendMessage(binding.tabId, { target: 'content', type: 'execute', source: session.source, step, value: message.value }, { documentId: binding.documentId });
  if (!result?.ok) throw new Error(result?.error || 'This step could not be dispatched.');
  return { ok: true, status: 'dispatched' };
}

async function captured(message, sender) {
  const { active } = await state();
  if (!active || sender.tab?.id !== active.tabId || sender.frameId !== 0 || sender.documentId !== active.documentId || message.sessionId !== active.sessionId) throw new Error('The recording binding has expired.');
  if (message.type === 'stop') return stop('The original page ended or you stopped recording.');
  if (!sameSource(safeSource(sender.url), active.source)) throw new Error('The recording page changed.');
  const step = validateStep(message.step);
  const elapsed = Date.now() - active.startedAt;
  if (elapsed > 300_000) return stop('The five-minute recording limit was reached.');
  if (step.at > elapsed + 2000) throw new Error('Invalid action timestamp.');
  let reached = false;
  try {
    await updateSession(active.sessionId, row => {
      if (row.status !== 'recording') throw new Error('Recording has stopped.');
      if (row.steps.length >= 500) { reached = true; return row; }
      if (row.steps.some(x => x.id === step.id) || step.at < (row.steps.at(-1)?.at ?? 0)) throw new Error('Duplicate or unordered action.');
      const steps = [...row.steps, step];
      reached = steps.length === 500;
      return { ...row, steps };
    });
  } catch (error) {
    await stop('Actions could not be saved. This recording is partial.', true);
    throw error;
  }
  if (reached) await stop('The 500-action recording limit was reached.');
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'worker') return;
  const isUI = !sender.tab && uiURLs.some(url => sender.url?.split('?')[0].split('#')[0] === url);
  // Extension pages opened as tabs carry sender.tab, unlike popup pages.
  const isWorkspace = sender.url?.split('?')[0].split('#')[0] === uiURLs[1];
  const isOffscreen = sender.url === offscreenURL && !sender.tab;
  const fromContent = sender.tab && sender.url?.startsWith('http');
  if (!isUI && !isWorkspace && !isOffscreen && !fromContent) { respond({ ok: false, error: 'This sender is not allowed.' }); return; }
  const handle = async () => {
    if (fromContent) {
      if (!['capture-event', 'stop'].includes(message.type)) throw new Error('Page messages cannot control Tracelet.');
      return captured(message, sender);
    }
    if (isOffscreen) {
      if (message.type !== 'capture-finished') throw new Error('Unknown recorder message.');
      const { active } = await state();
      if (active?.sessionId === message.sessionId) return stop(message.error || 'Recording finished.', Boolean(message.error));
      return { ok: true };
    }
    if (message.type === 'status') { await recover(); return { ok: true, ...(await state()), active: (await state()).active ?? null, binding: (await state()).binding ?? null }; }
    if (message.type === 'start' && isUI && sender.url === uiURLs[0]) return start(message.tabId);
    if (message.type === 'stop') return stop();
    if (message.type === 'bind' && isUI && sender.url === uiURLs[0]) return bind(message.tabId);
    if (message.type === 'execute' && isWorkspace) return execute(message);
    throw new Error('Unknown workspace operation.');
  };
  serial(handle).then(respond).catch(error => respond({ ok: false, error: error.message || 'Tracelet could not finish this operation.' }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading' && !change.url) return;
  void serial(async () => {
    const saved = await state();
    const changed = binding => {
      if (change.status === 'loading') return true;
      try { return !sameSource(safeSource(change.url), binding.source); } catch { return true; }
    };
    if (saved.binding?.tabId === tabId && changed(saved.binding)) await chrome.storage.session.remove('binding');
    if (saved.active?.tabId === tabId && changed(saved.active)) await stop('Page navigation ended this recording.');
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  void serial(async () => {
    const saved = await state();
    if (saved.binding?.tabId === tabId) await chrome.storage.session.remove('binding');
    if (saved.active?.tabId === tabId) await stop('The recorded tab was closed.', true);
  }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { void serial(recover).catch(() => {}); });
