import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyze, safeSource, toMarkdown, toWorkflow, validateStep, validateWorkflow,
} from '../extension/lib/workflow.mjs';

const target = () => ({ selector: '#continue', tag: 'button', type: 'button', label: 'Continue' });
const step = (id = 'step-1', at = 0, kind = 'click') => ({
  id, at, kind, label: 'Continue', note: '',
  target: kind === 'manual' ? null : kind === 'field'
    ? { selector: '#city', tag: 'input', type: 'text', label: 'City' } : target(),
});
const workflow = () => ({
  format: 'tracelet', version: 1, title: 'Plan a visit',
  source: { origin: 'https://example.com', path: '/planner' }, steps: [step()],
});
const session = () => ({ ...workflow(), startedAt: 100_000, stoppedAt: 140_000 });
const rejected = raw => assert.throws(() => validateWorkflow(raw), /workflow_/);

test('a workflow JSON round trip preserves the ordered non-executable checklist', () => {
  const raw = workflow();
  raw.steps.push(step('step-2', 2500, 'field'), step('step-3', 4000, 'manual'));
  const result = validateWorkflow(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(result, raw);
  assert.deepEqual(validateWorkflow(JSON.parse(JSON.stringify(result))), raw);
  assert.deepEqual(result.steps.map(row => row.kind), ['click', 'field', 'manual']);
});

test('session processing projects workflow data without recovery or video metadata', () => {
  const raw = { ...session(), id: 'local-session', status: 'interrupted',
    videoChunks: ['private-video-reference'], error: 'private recovery detail',
    parameters: { city: 'never-export-this-value' } };
  assert.deepEqual(toWorkflow(raw), workflow());
  const encoded = JSON.stringify(toWorkflow(raw));
  for (const secret of ['private-video-reference', 'private recovery detail', 'never-export-this-value']) {
    assert.equal(encoded.includes(secret), false);
  }
});

test('validation leaves caller-owned objects unchanged and returns detached data', () => {
  const raw = workflow(); const before = structuredClone(raw);
  const result = validateWorkflow(raw);
  assert.deepEqual(raw, before);
  assert.notEqual(result, raw); assert.notEqual(result.source, raw.source);
  assert.notEqual(result.steps, raw.steps); assert.notEqual(result.steps[0].target, raw.steps[0].target);
  result.steps[0].label = 'Edited checklist';
  assert.equal(raw.steps[0].label, 'Continue');
});

test('imports reject primitive and non-plain containers', () => {
  for (const raw of [null, false, 1, 'workflow', [], new Date(), Object.create(workflow())]) rejected(raw);
});

test('unknown keys and recorded values are rejected at every workflow boundary', () => {
  for (const mutate of [
    raw => { raw.script = 'alert(1)'; },
    raw => { raw.source.query = 'token=private'; },
    raw => { raw.steps[0].value = 'private input'; },
    raw => { raw.steps[0].target.value = 'private input'; },
    raw => { raw.steps[0].target.onClick = 'run()'; },
  ]) { const raw = workflow(); mutate(raw); rejected(raw); }
});

test('format and version never silently accept a foreign executable schema', () => {
  for (const [key, value] of [['format', 'javascript'], ['version', 2], ['version', '1']]) {
    const raw = workflow(); raw[key] = value; rejected(raw);
  }
});

test('missing required workflow and step keys are rejected', () => {
  for (const key of Object.keys(workflow())) { const raw = workflow(); delete raw[key]; rejected(raw); }
  for (const key of Object.keys(step())) { const raw = workflow(); delete raw.steps[0][key]; rejected(raw); }
  for (const key of Object.keys(workflow().source)) { const raw = workflow(); delete raw.source[key]; rejected(raw); }
});

test('duplicate step identities cannot become two replay approvals', () => {
  const raw = workflow(); raw.steps.push(step('step-1', 1)); rejected(raw);
});

test('timestamps reject backward order and non-finite fractional or out-of-range values', () => {
  for (const at of [-1, 0.5, NaN, Infinity, 300_001, '1']) {
    const raw = workflow(); raw.steps[0].at = at; rejected(raw);
  }
  const raw = workflow(); raw.steps = [step('first', 20), step('second', 19)]; rejected(raw);
});

test('equal timestamps and the exact five-minute endpoint retain event order', () => {
  const raw = workflow(); raw.steps = [step('first', 0), step('second', 0), step('last', 300_000)];
  assert.deepEqual(validateWorkflow(raw).steps.map(row => row.id), ['first', 'second', 'last']);
});

test('the five-hundred-step boundary is accepted while the next step is refused', () => {
  const raw = workflow(); raw.steps = Array.from({ length: 500 }, (_, index) => step(`step-${index}`, index));
  assert.equal(validateWorkflow(raw).steps.length, 500);
  raw.steps.push(step('step-500', 500)); rejected(raw);
});

test('title label note selector and identity caps are enforced without truncation', () => {
  for (const [location, key, limit] of [
    ['workflow', 'title', 120], ['step', 'label', 160], ['step', 'note', 1000],
    ['step', 'id', 80], ['target', 'selector', 500], ['target', 'label', 160],
  ]) {
    const raw = workflow(); const row = location === 'workflow' ? raw : location === 'step' ? raw.steps[0] : raw.steps[0].target;
    row[key] = 'x'.repeat(limit); assert.equal(validateWorkflow(raw).steps.length, 1);
    row[key] += 'x'; rejected(raw);
  }
});

test('multiline notes remain text while control characters cannot enter identity fields', () => {
  const raw = workflow(); raw.steps[0].note = 'First line\nSecond line with context';
  assert.equal(validateWorkflow(raw).steps[0].note, raw.steps[0].note);
  for (const mutate of [
    value => { value.title = 'Bad\u0000title'; },
    value => { value.steps[0].label = 'Bad\nlabel'; },
    value => { value.steps[0].target.selector = '#bad\rselector'; },
  ]) { const value = workflow(); mutate(value); rejected(value); }
});

test('unpaired Unicode surrogates are rejected instead of silently changing exported data', () => {
  for (const value of ['\ud800', '\udfff']) { const raw = workflow(); raw.title = value; rejected(raw); }
});

test('target records are exact data and manual steps can omit an executable target', () => {
  assert.equal(validateStep(step('manual', 0, 'manual')).target, null);
  const normalized = step(); normalized.target.tag = 'BUTTON'; normalized.target.type = 'BUTTON';
  assert.deepEqual(validateStep(normalized).target, target());
  for (const mutate of [
    raw => { raw.steps[0].target = null; },
    raw => { raw.steps[0].target = '#continue'; },
    raw => { delete raw.steps[0].target.label; },
    raw => { raw.steps[0].kind = 'evaluate'; },
  ]) { const raw = workflow(); mutate(raw); rejected(raw); }
});

test('field tasks exclude credential hidden file and submit-like controls', () => {
  for (const type of ['password', 'hidden', 'file', 'button', 'submit', 'reset', 'image']) {
    const raw = workflow(); raw.steps = [step('field', 0, 'field')]; raw.steps[0].target.type = type; rejected(raw);
  }
  const raw = workflow(); raw.steps = [step('field', 0, 'field')]; raw.steps[0].target.tag = 'button'; rejected(raw);
});

test('imported sources must already be canonical and cannot hide a query or fragment', () => {
  for (const source of [
    { origin: 'https://example.com/path', path: '/planner' },
    { origin: 'https://example.com', path: '/planner?token=private' },
    { origin: 'https://example.com', path: '/planner#private' },
    { origin: 'https://person:secret@example.com', path: '/planner' },
    { origin: 'javascript:alert(1)', path: '/' },
  ]) { const raw = workflow(); raw.source = source; rejected(raw); }
});

test('recording a source strips private URL query and fragment values', () => {
  assert.deepEqual(safeSource('https://example.com/planner?token=never-export#private-note'), {
    origin: 'https://example.com', path: '/planner',
  });
  assert.deepEqual(safeSource('http://localhost:8080/a%20b?city=secret'), {
    origin: 'http://localhost:8080', path: '/a%20b',
  });
});

test('source capture refuses credentials and non-web protocols', () => {
  for (const url of ['https://person:secret@example.com/', 'file:///private/data', 'data:text/html,private', 'javascript:alert(1)', 'chrome://settings']) {
    assert.throws(() => safeSource(url), /workflow_/);
  }
});

test('Markdown renders hostile HTML and link syntax as text without private session data', () => {
  const raw = session(); raw.title = '<script>alert(1)</script>';
  raw.steps[0].label = '[Execute](javascript:alert(1))';
  raw.steps[0].note = '<img src=x onerror=alert(1)>\n- [ ] forged task';
  raw.parameters = { password: 'never-export-this-value' };
  const markdown = toMarkdown(raw);
  assert.equal(typeof markdown, 'string');
  assert.equal(markdown.includes('<script>'), false); assert.equal(markdown.includes('<img '), false);
  assert.equal(markdown.includes('[Execute](javascript:'), false);
  assert.equal(markdown.includes('never-export-this-value'), false);
  assert.match(markdown, /alert/); assert.match(markdown, /forged task/);
});

test('analysis counts event kinds and reports the recorded stopped duration', () => {
  const raw = session(); raw.steps = [step('click', 0), step('field', 3000, 'field'), step('manual', 5000, 'manual')];
  assert.deepEqual(analyze(raw), { durationMs: 40_000, total: 3, clicks: 1, fields: 1, manual: 1 });
});

test('recording finalization retains observed duration beyond the bounded action timeline', () => {
  const raw = session(); raw.steps = [step('last', 300_000)]; raw.stoppedAt = raw.startedAt + 300_025;
  assert.deepEqual(analyze(raw), { durationMs: 300_025, total: 1, clicks: 1, fields: 0, manual: 0 });
  assert.equal(toWorkflow(raw).steps[0].at, 300_000);
});

test('active or interrupted analysis uses the last recorded event without a running clock', () => {
  const raw = session(); raw.stoppedAt = null; raw.status = 'interrupted'; raw.steps = [step('first', 0), step('last', 12_345)];
  assert.deepEqual(analyze(raw), { durationMs: 12_345, total: 2, clicks: 2, fields: 0, manual: 0 });
  assert.deepEqual(analyze(structuredClone(raw)), analyze(raw));
});

test('an empty checklist remains a valid reviewable workflow rather than an automatic action', () => {
  const raw = session(); raw.steps = []; raw.stoppedAt = null;
  assert.deepEqual(validateWorkflow(toWorkflow(raw)).steps, []);
  assert.deepEqual(analyze(raw), { durationMs: 0, total: 0, clicks: 0, fields: 0, manual: 0 });
});

test('prototype keys and accessor input are refused without invoking supplied code', () => {
  const raw = JSON.parse(JSON.stringify(workflow()).replace('"format":', '"__proto__":{"polluted":true},"format":'));
  rejected(raw); assert.equal({}.polluted, undefined);
  let calls = 0; const accessor = workflow();
  Object.defineProperty(accessor, 'title', { enumerable: true, get() { calls += 1; throw new Error('untrusted getter'); } });
  rejected(accessor); assert.equal(calls, 0);
  const arrayAccessor = workflow(); arrayAccessor.steps = [];
  Object.defineProperty(arrayAccessor.steps, '0', { enumerable: true, get() { calls += 1; throw new Error('untrusted array getter'); } });
  rejected(arrayAccessor); assert.equal(calls, 0);
  const sparse = workflow(); sparse.steps = new Array(1); rejected(sparse);
  const symbol = workflow(); symbol[Symbol('untrusted')] = true; rejected(symbol);
});
