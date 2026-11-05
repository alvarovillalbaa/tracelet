import { safeSource } from './lib/workflow.mjs';

const $ = id => document.getElementById(id);
let tab = null, active = null, busy = false;
const message = text => { $('popup-status').textContent = text; $('popup-status').hidden = !text; };
function controls() {
  $('start').hidden = Boolean(active); $('start').disabled = busy || !tab;
  $('stop').hidden = !active; $('stop').disabled = busy;
  $('bind').disabled = busy || !tab || Boolean(active);
  $('active-recording').hidden = !active;
}
async function rpc(type) {
  const result = await chrome.runtime.sendMessage({ target: 'worker', type, ...(tab ? { tabId: tab.id } : {}) });
  if (!result?.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Tracelet could not complete this action.');
  return result;
}
async function action(type) {
  if (busy) return;
  busy = true; controls(); message(type === 'start' ? 'Starting this tab’s recording…' : type === 'stop' ? 'Saving your recording…' : 'Selecting this tab…');
  try { await rpc(type); window.close(); }
  catch (error) { message(error.message.slice(0, 240)); }
  finally { busy = false; controls(); }
}
$('start').addEventListener('click', () => void action('start'));
$('stop').addEventListener('click', () => void action('stop'));
$('bind').addEventListener('click', () => void action('bind'));
try {
  const library = chrome.runtime.getURL('workspace.html');
  $('library').href = library; $('library-brand').href = library;
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const source = safeSource(current?.url);
    tab = { id: current.id, source }; $('current-site').textContent = source.origin + source.path;
  } catch { $('current-site').textContent = 'Open a regular website to begin.'; }
  const status = await rpc('status'); active = status.active;
  if (active) {
    const minutes = Math.max(0, Math.floor((Date.now() - active.startedAt) / 60000));
    $('recording-time').textContent = `${active.tabId !== tab?.id ? 'Another tab is recording. ' : ''}${minutes} minute${minutes === 1 ? '' : 's'} elapsed · stop to review.`;
  }
  controls();
} catch { message('Tracelet is unavailable. Open it from the browser toolbar and try again.'); controls(); }
