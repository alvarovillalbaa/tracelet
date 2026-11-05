import { listSessions, getSession, saveSession, deleteSession, getVideo } from './lib/db.mjs';
import { validateWorkflow, validateStep, toWorkflow, analyze, toMarkdown } from './lib/workflow.mjs';

const $ = id => document.getElementById(id);
const parameters = new Map();
let saved = null, draft = null, dirty = false, binding = null, active = null;
let video = null, videoURL = null, generation = 0, running = false, saving = false, opening = false, statusBusy = false;
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notice(text, error = false) {
  $('status').textContent = text; $('status').hidden = !text;
  $('status').classList.toggle('error', error); $('status').setAttribute('role', error ? 'alert' : 'status');
}
function problem(error, fallback) {
  return error?.message?.startsWith('workflow_') ? 'Check the workflow’s title, steps and page address. Unsupported or invalid data was kept out of your library.' : fallback;
}
function elapsed(ms) { const seconds = Math.floor(Math.max(0, ms || 0) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function bytes(size) { return size >= 1048576 ? `${(size / 1048576).toFixed(1)} MiB` : `${Math.ceil(size / 1024)} KiB`; }
function site(source) { return source ? source.origin + source.path : 'No page selected'; }
function editable() { return Boolean(draft && draft.status !== 'recording' && !saving && !running && !opening); }
function matchingTab() { return Boolean(binding && draft && binding.source?.origin === draft.source.origin && binding.source?.path === draft.source.path); }
function changed() { dirty = true; updateControls(); }
function updateControls() {
  const canEdit = editable();
  $('import').disabled = saving || running || opening; $('refresh').disabled = saving || running || opening;
  $('library-list').querySelectorAll('button').forEach(node => { node.disabled = saving || running || opening; });
  $('save').disabled = !canEdit || !dirty; $('discard').disabled = !canEdit || !dirty;
  $('session-title').disabled = !canEdit; $('delete').disabled = !canEdit;
  $('manual-form').querySelectorAll('input,textarea,button').forEach(node => { node.disabled = !canEdit || (draft?.steps.length ?? 0) >= 500; });
  $('steps').querySelectorAll('[data-edit]').forEach(node => { node.disabled = !canEdit; });
  $('steps').querySelectorAll('[data-run]').forEach(node => { node.disabled = !canEdit || dirty || !matchingTab(); });
  $('steps').querySelectorAll('[data-parameter]').forEach(node => { node.disabled = !canEdit; });
  $('save-state').textContent = dirty ? 'Unsaved changes' : draft?.status === 'recording' ? 'Stop recording to edit tasks' : 'Saved on this device';
  $('export-json').disabled = !draft || draft.status === 'recording' || saving || running || opening;
  $('export-markdown').disabled = $('export-json').disabled;
  $('download-video').disabled = !draft || draft.status === 'recording';
  $('binding-title').textContent = binding ? site(binding.source) : 'Choose a site tab';
  $('binding-description').textContent = dirty ? 'Save your edits before running a step.' : matchingTab()
    ? 'This page is selected. Each Run button approves one action; review it before continuing.'
    : 'Open the matching website, click Tracelet in its toolbar, then choose “Use this tab for tasks”.';
  $('binding-state').textContent = matchingTab() ? 'PAGE MATCHES' : binding ? 'DIFFERENT PAGE' : 'NO TAB SELECTED';
}
async function rpc(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ target: 'worker', type, ...extra });
  if (!result?.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Tracelet could not complete this action.');
  return result;
}
async function status() {
  if (statusBusy) return;
  statusBusy = true;
  try {
    const result = await rpc('status'); binding = result.binding; active = result.active;
    $('active-banner').hidden = !active;
    updateControls();
    if (draft?.status === 'recording' && !active && !dirty && !saving && !running && !opening) await open(draft.id, true);
  } catch { notice('The browser connection is unavailable. Your saved library is still local.', true); }
  finally { statusBusy = false; }
}
async function library() {
  const rows = await listSessions(); $('library-list').replaceChildren();
  if (!rows.length) { $('library-list').append(el('p', 'Your first recording will live here.', 'library-empty')); return rows; }
  for (const row of rows) {
    const button = el('button', undefined, 'library-item'); button.type = 'button';
    button.disabled = saving || running || opening;
    button.setAttribute('aria-current', row.id === saved?.id ? 'true' : 'false');
    button.append(el('strong', row.title || 'Untitled recording'), el('span', `${row.status === 'workflow' ? 'Workflow' : row.status === 'partial' ? 'Partial recording' : row.status === 'recording' ? 'Recording' : 'Recording'} · ${new Date(row.createdAt).toLocaleDateString()}`));
    button.addEventListener('click', () => void open(row.id).catch(() => notice('This recording could not be opened.', true)));
    $('library-list').append(button);
  }
  return rows;
}
function clearVideo() {
  $('video').pause(); $('video').removeAttribute('src'); $('video').load();
  if (videoURL) URL.revokeObjectURL(videoURL);
  videoURL = null; video = null; $('video-section').hidden = true;
}
async function open(id, force = false) {
  if ((saving || running || opening) && !force) return;
  if (dirty && !force && !confirm('Discard your unsaved edits and open another recording?')) return;
  opening = true; updateControls(); $('review').setAttribute('aria-busy', 'true');
  try {
    const ticket = ++generation, row = await getSession(id);
    if (ticket !== generation) return;
    if (!row) throw new Error('missing_session');
    toWorkflow(row);
    saved = structuredClone(row); draft = structuredClone(row); dirty = false; parameters.clear();
    clearVideo(); render();
    const url = new URL(location.href); url.searchParams.set('session', row.id); history.replaceState(null, '', url);
    await library();
    try {
      const blob = await getVideo(row.id);
      if (ticket !== generation || !blob) return;
      video = blob; videoURL = URL.createObjectURL(blob); $('video').src = videoURL; $('video-section').hidden = false;
    } catch { if (ticket === generation) notice('Tasks are available, but the recording’s video could not be read.', true); }
  } finally { opening = false; $('review').removeAttribute('aria-busy'); updateControls(); }
}
function renderSummary() {
  const facts = analyze(draft); $('summary').replaceChildren();
  for (const [value, label] of [[elapsed(facts.durationMs), 'Duration'], [facts.clicks, 'Clicks'], [facts.fields, 'Fields to fill'], [facts.manual, 'Manual steps']]) {
    const card = el('div', undefined, 'summary-item'); card.append(el('strong', String(value)), el('span', label)); $('summary').append(card);
  }
  $('step-count').textContent = `${facts.total} step${facts.total === 1 ? '' : 's'} · field values are never saved`;
}
function renderSteps() {
  $('steps').replaceChildren();
  if (!draft.steps.length) { $('steps').append(el('li', 'No actions were captured. Add a manual step to begin.', 'steps-empty')); return; }
  for (const step of draft.steps) {
    const row = el('li', undefined, 'step-card');
    const heading = el('div', undefined, 'step-top');
    heading.append(el('span', step.kind === 'field' ? 'FILL A FIELD' : step.kind === 'manual' ? 'MANUAL' : 'CLICK', 'step-kind'), el('span', elapsed(step.at), 'step-time'));
    const remove = el('button', 'Remove', 'quiet'); remove.type = 'button'; remove.dataset.edit = 'true'; remove.setAttribute('aria-label', `Remove step: ${step.label}`);
    remove.addEventListener('click', () => { draft.steps = draft.steps.filter(item => item.id !== step.id); parameters.delete(step.id); changed(); renderSteps(); renderSummary(); updateControls(); });
    heading.append(remove); row.append(heading);
    const title = el('label', 'Step label'); const input = el('input'); input.value = step.label; input.maxLength = 160; input.dataset.edit = 'true';
    input.addEventListener('input', () => { step.label = input.value; changed(); }); title.append(input); row.append(title);
    const notes = el('label', 'Notes'); const note = el('textarea'); note.rows = 2; note.value = step.note; note.maxLength = 1000; note.dataset.edit = 'true';
    note.addEventListener('input', () => { step.note = note.value; changed(); }); notes.append(note); row.append(notes);
    if (step.target) {
      const target = el('details', undefined, 'target-details'); target.append(el('summary', `Target: ${step.target.label || step.target.tag}`), el('code', step.target.selector)); row.append(target);
    }
    if (step.kind === 'manual') row.append(el('p', 'Do this yourself. This step is never sent to the page.', 'small muted'));
    else {
      if (step.kind === 'field') {
        const label = el('label', 'Value for this run'); const parameter = el('input'); parameter.type = 'text'; parameter.autocomplete = 'off'; parameter.spellcheck = false; parameter.maxLength = 4000; parameter.value = parameters.get(step.id) ?? ''; parameter.dataset.parameter = 'true';
        parameter.addEventListener('input', () => parameters.set(step.id, parameter.value)); label.append(parameter); row.append(label, el('p', 'Kept only in this window. Never enter passwords, payment details or one-time codes.', 'small muted'));
      }
      const action = el('div', undefined, 'step-action'); action.append(el('span', site(draft.source), 'step-site'));
      const run = el('button', step.kind === 'field' ? 'Fill this field ↗' : 'Run this click ↗', 'button secondary'); run.type = 'button'; run.dataset.run = step.id;
      run.addEventListener('click', () => void execute(step, row)); action.append(run); row.append(action);
    }
    $('steps').append(row);
  }
}
function render() {
  $('empty').hidden = !draft ? false : true; $('editor').hidden = !draft;
  if (!draft) { updateControls(); return; }
  $('review-title').textContent = draft.title; $('session-title').value = draft.title;
  $('session-kind').textContent = draft.status === 'workflow' ? 'IMPORTED WORKFLOW' : draft.status === 'recording' ? 'RECORDING IN PROGRESS' : draft.status === 'partial' ? 'PARTIAL RECORDING' : 'RECORDING & TASKS';
  $('source').textContent = site(draft.source);
  $('partial-note').hidden = draft.status !== 'partial';
  $('partial-note').textContent = 'This recording was interrupted. Video or actions may be incomplete; review every step before using it.';
  renderSummary(); renderSteps(); updateControls();
}
async function execute(step, row) {
  if (!editable() || dirty || !matchingTab()) return;
  const valueInput = row.querySelector('[data-parameter]');
  if (step.kind === 'field' && !parameters.has(step.id)) { notice('Enter the value for this run before filling the field.', true); valueInput?.focus(); return; }
  running = true; updateControls();
  try {
    await rpc('execute', { sessionId: saved.id, stepId: step.id, expectedStep: validateStep(step), ...(step.kind === 'field' ? { value: parameters.get(step.id) } : {}) });
    parameters.delete(step.id); if (valueInput) valueInput.value = '';
    notice('Action dispatched. Check the selected page before approving another step.');
  } catch (error) { notice(error.message.slice(0, 240), true); }
  finally { running = false; await status(); updateControls(); }
}
function download(name, blob) {
  const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename() { return (draft.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64) || 'tracelet'); }
$('session-title').addEventListener('input', () => { if (draft) { draft.title = $('session-title').value; $('review-title').textContent = draft.title || 'Untitled workflow'; changed(); } });
$('save').addEventListener('click', async () => {
  if (!editable() || !dirty) return;
  saving = true; updateControls();
  try { const row = await saveSession(draft); saved = structuredClone(row); draft = structuredClone(row); dirty = false; render(); await library(); notice('Changes saved on this device.'); }
  catch (error) { notice(problem(error, 'Changes could not be saved. Reopen this item if another window changed it; your unsaved edits are still here.'), true); }
  finally { saving = false; updateControls(); }
});
$('discard').addEventListener('click', () => { if (saved && confirm('Discard your unsaved task edits?')) { draft = structuredClone(saved); dirty = false; render(); } });
$('manual-form').addEventListener('submit', event => {
  event.preventDefault(); if (!editable() || draft.steps.length >= 500) return;
  try {
    const step = validateStep({ id: crypto.randomUUID(), at: draft.steps.at(-1)?.at ?? 0, kind: 'manual', label: $('manual-label').value.trim(), note: $('manual-note').value, target: null });
    draft.steps.push(step); $('manual-form').reset(); changed(); renderSteps(); renderSummary(); updateControls();
  } catch { notice('Enter a step label and keep notes within 1,000 characters.', true); }
});
$('delete').addEventListener('click', async () => {
  if (!editable() || !confirm(`Delete “${saved.title}”, its video and all its steps from this device? This cannot be undone.`)) return;
  saving = true; updateControls();
  try {
    await deleteSession(saved.id); generation++; saved = null; draft = null; dirty = false; parameters.clear(); clearVideo(); render();
    const url = new URL(location.href); url.searchParams.delete('session'); history.replaceState(null, '', url);
    await library(); notice('Recording and tasks deleted from this device.');
  } catch { notice('This recording could not be deleted. Stop it first if it is still recording.', true); }
  finally { saving = false; updateControls(); }
});
$('export-json').addEventListener('click', () => { try { download(filename() + '.tracelet.json', new Blob([JSON.stringify(toWorkflow(draft), null, 2) + '\n'], { type: 'application/json' })); } catch (error) { notice(problem(error, 'The workflow could not be exported.'), true); } });
$('export-markdown').addEventListener('click', () => { try { download(filename() + '.md', new Blob([toMarkdown(draft)], { type: 'text/markdown;charset=utf-8' })); } catch (error) { notice(problem(error, 'The task list could not be exported.'), true); } });
$('download-video').addEventListener('click', () => { if (video) download(filename() + '.webm', video); });
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const input = event.currentTarget, file = input.files?.[0]; input.value = ''; if (!file) return;
  if (saving || running || opening) return;
  saving = true; updateControls();
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('workflow_file_limit');
    const workflow = validateWorkflow(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())));
    if (dirty && !confirm('Discard unsaved edits and open this imported workflow?')) return;
    const now = Date.now(), row = await saveSession({ id: crypto.randomUUID(), title: workflow.title, source: workflow.source, steps: workflow.steps,
      createdAt: now, startedAt: now, stoppedAt: now + (workflow.steps.at(-1)?.at ?? 0), status: 'workflow', reason: '', byteLength: 0, mimeType: '' });
    await open(row.id, true); notice('Workflow imported as a new library item. No actions were run.');
  } catch (error) { notice(problem(error, 'This file could not be imported. Your current work was kept.'), true); }
  finally { saving = false; updateControls(); }
});
$('refresh').addEventListener('click', async () => { try { await library(); await status(); if (draft?.status === 'recording' && !active && !dirty) await open(draft.id, true); } catch { notice('The library could not be refreshed.', true); } });
$('stop-recording').addEventListener('click', async () => { $('stop-recording').disabled = true; try { await rpc('stop'); await status(); await library(); if (draft?.status === 'recording' && !dirty) await open(draft.id, true); notice('Recording stopped. Review the saved video and steps.'); } catch { notice('Recording could not be stopped. Try the toolbar or the in-page stop control.', true); } finally { $('stop-recording').disabled = false; } });
$('video').addEventListener('error', () => { if (videoURL) notice('This video could not be played here. You can still review the tasks or download the original recording.', true); });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { parameters.clear(); $('steps').querySelectorAll('[data-parameter]').forEach(input => { input.value = ''; }); clearVideo(); });
try {
  const rows = await library(); await status();
  const id = new URL(location.href).searchParams.get('session') || rows[0]?.id;
  if (id) await open(id); else render();
} catch { notice('Your library could not be loaded. Close other Tracelet windows and try again.', true); }
setInterval(() => void status(), 3000);
