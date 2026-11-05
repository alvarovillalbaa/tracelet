import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const extension = path.join(root, 'extension');
const cases = [{ id: 'B01', viewport: { width: 1440, height: 1000 } },
  { id: 'B02', viewport: { width: 390, height: 844 } }];
const report = { kind: 'tracelet-browser-checks', cases: [], passed: 0, failed: 0, unrun: 0, pageErrors: [],
  unexpectedRequests: 0, fixtureRequests: 0, interrupted: false, cleanup: {},
  proofLimits: [
    'Two real installed-extension workspace journeys: desktop and plain narrow viewport.',
    'Real chooser imports, IndexedDB persistence, edits, JSON/Markdown downloads and confirmed deletion.',
    'No tabCapture, recording, permission grant, replay dispatch, touch, store or production acceptance.',
    'Context-close acknowledgments and owned-directory identities are recorded; outer CI owns process inventory.',
  ] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contexts = new Set(), closing = new Map();
let interrupted = false, server, serverClosed = false, scratchHandle, scratchIdentity;
const scratch = process.env.TRACELET_SCRATCH;
function errorEvidence(error) {
  const raw = Buffer.from(String(error?.message ?? error));
  const sanitized = Buffer.from(raw.toString('utf8').replaceAll(scratch || '\u0000', '[scratch]')
    .replace(/https?:\/\/[^\s)]+/g, '[authored-url]'));
  const excerpt = (bytes, limit, tail = false) => {
    let text = (tail ? bytes.subarray(-limit) : bytes.subarray(0, limit)).toString('utf8');
    while (Buffer.byteLength(text) > limit) text = tail ? text.slice(1) : text.slice(0, -1);
    return text;
  };
  return { messageBytes: raw.length, messageSha256: sha(raw), sanitizedMessageBytes: sanitized.length,
    head: excerpt(sanitized, 500), tail: sanitized.length > 500 ? excerpt(sanitized, Math.min(6000, sanitized.length - 500), true) : '',
    truncated: sanitized.length > 6500 };
}
function errorText(error) {
  const evidence = errorEvidence(error);
  return evidence.head + (evidence.truncated ? '\n[...message middle omitted...]\n' : '') + evidence.tail;
}
function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
function closeContext(context) {
  if (!closing.has(context)) closing.set(context, context.close().then(() => { contexts.delete(context); }));
  return closing.get(context);
}
function interrupt() {
  interrupted = true; report.interrupted = true;
  for (const context of contexts) void closeContext(context).catch(() => {});
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, interrupt);
const workTimer = setTimeout(interrupt, 150_000);
const checkActive = () => assert(!interrupted, 'The bounded browser packet was interrupted.');
async function identity(directory) {
  const info = await fs.lstat(directory);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Owned directory became unsafe.');
  return { dev: info.dev, ino: info.ino };
}
async function verifyScratch() {
  assert.deepEqual(await identity(scratch), scratchIdentity);
  const held = await scratchHandle.stat();
  assert(held.dev === scratchIdentity.dev && held.ino === scratchIdentity.ino, 'Scratch identity changed.');
}
async function boundedProcRead(filename) {
  const handle = await fs.open(filename, 'r');
  try {
    const buffer = Buffer.alloc(65_537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    assert(bytesRead <= 65_536, 'A process identity file exceeded its read bound.');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
async function ownedProcessScan(owned, deadline) {
  const processes = (await fs.readdir('/proc')).filter(name => /^[0-9]+$/.test(name));
  assert(processes.length <= 8192, 'Process enumeration exceeded its bound.');
  const matches = [];
  const inside = value => value === owned || value.startsWith(owned + path.sep);
  for (const pid of processes) {
    assert(Date.now() < deadline, 'Process ownership inspection exceeded its deadline.');
    try {
      if ((await fs.stat('/proc/' + pid)).uid !== process.getuid()) continue;
      const stat = await boundedProcRead('/proc/' + pid + '/stat');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      assert(fields.length >= 20 && /^[0-9]+$/.test(fields[19]), 'Process starttime was not available.');
      const args = (await boundedProcRead('/proc/' + pid + '/cmdline')).split('\u0000');
      const environment = (await boundedProcRead('/proc/' + pid + '/environ')).split('\u0000');
      const argvMatch = args.some(value => inside(value) || (/^--[a-zA-Z0-9_-]+=/.test(value) && inside(value.slice(value.indexOf('=') + 1))));
      const environmentMatch = environment.some(entry => {
        const equals = entry.indexOf('=');
        const key = entry.slice(0, equals);
        return equals > 0 && (key === 'TMPDIR' || /^XDG_[A-Z0-9_]+$/.test(key)) && inside(entry.slice(equals + 1));
      });
      if (argvMatch || environmentMatch) {
        const current = await boundedProcRead('/proc/' + pid + '/stat');
        const currentFields = current.slice(current.lastIndexOf(')') + 2).trim().split(/\s+/);
        if (currentFields[19] === fields[19]) matches.push(pid + ':' + fields[19]);
      }
    } catch (error) {
      // An exited process is gone. Permission/shape uncertainty for a same-UID
      // process is not evidence that an owned browser has stopped.
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
    }
  }
  return matches;
}
async function verifyNoOwnedProcesses(owned, cleanup) {
  const deadline = Date.now() + 5000, observed = new Set();
  const proof = cleanup.processOwnership = { observedPIDs: 0, remainingPIDs: null, uncertain: false, passed: false };
  try {
    while (Date.now() < deadline) {
      const remaining = await bounded(ownedProcessScan(owned, deadline), Math.max(1, deadline - Date.now()), 'Process ownership inspection exceeded its deadline.');
      remaining.forEach(value => observed.add(value));
      proof.observedPIDs = observed.size; proof.remainingPIDs = remaining.length;
      if (!remaining.length) { proof.passed = true; return; }
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
    throw new Error('Owned browser processes remained after context close.');
  } catch (error) { proof.uncertain = true; throw error; }
}
async function chooser(page, filename) {
  const [event] = await Promise.all([page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import a workflow', exact: true }).click()]);
  await event.setFiles(filename);
}
async function download(page, button, directory, kind) {
  const [item] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
  assert.equal(await item.failure(), null, `${kind} download failed.`);
  const filename = await item.path();
  const actual = await fs.realpath(filename), expected = await fs.realpath(directory);
  assert(actual.startsWith(expected + path.sep), 'A download escaped its owned directory.');
  const info = await fs.lstat(actual);
  assert(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 256 * 1024, 'Unexpected download shape.');
  const bytes = await fs.readFile(actual);
  assert.equal(bytes.length, info.size);
  return { bytes, metadata: { kind, bytes: bytes.length, sha256: sha(bytes) } };
}
async function narrowLayout(page, item, configuration, phase) {
  if (configuration.viewport.width !== 390) return;
  const observed = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    innerWidth: window.innerWidth,
  }));
  (item.layoutObservations ??= []).push({ phase, ...observed });
  assert(observed.scrollWidth <= observed.innerWidth, `Narrow workspace overflowed during ${phase}.`);
}
async function journey(chromium, fixtureOrigin, configuration) {
  checkActive(); await verifyScratch();
  const started = Date.now(), item = { id: configuration.id, status: 'failed', downloads: [], cleanup: {} };
  report.cases.push(item);
  const owned = await fs.mkdtemp(path.join(scratch, `tracelet-${configuration.id}-`));
  const handle = await fs.open(owned, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const held = await handle.stat(), original = { dev: held.dev, ino: held.ino };
  const directories = Object.fromEntries(['profile', 'downloads', 'tmp', 'config', 'cache'].map(name => [name, path.join(owned, name)]));
  let context, launchAttempted = false, closeAcknowledged = false;
  try {
    for (const directory of Object.values(directories)) await fs.mkdir(directory, { mode: 0o700 });
    const imported = { format: 'tracelet', version: 1, title: `Imported ${configuration.id} workflow`,
      source: { origin: fixtureOrigin, path: '/task' }, steps: [
        { id: 'continue', at: 0, kind: 'click', label: 'Continue', note: '',
          target: { selector: '#continue', tag: 'button', type: 'button', label: 'Continue' } },
        { id: 'city', at: 1250, kind: 'field', label: 'Choose a city', note: '',
          target: { selector: '#city', tag: 'input', type: 'text', label: 'City' } },
      ] };
    const validFile = path.join(owned, 'authored-workflow.json'), invalidFile = path.join(owned, 'invalid-workflow.json');
    await fs.writeFile(validFile, JSON.stringify(imported), { flag: 'wx', mode: 0o600 });
    await fs.writeFile(invalidFile, '{"format":"tracelet","version":1,', { flag: 'wx', mode: 0o600 });
    launchAttempted = true;
    context = await chromium.launchPersistentContext(directories.profile, {
      channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: directories.downloads,
      viewport: configuration.viewport, isMobile: false, hasTouch: false, serviceWorkers: 'allow',
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
      timeout: 20_000,
      env: { ...process.env, TMPDIR: directories.tmp, XDG_CONFIG_HOME: directories.config, XDG_CACHE_HOME: directories.cache },
    });
    contexts.add(context);
    context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(10_000);
    const onPage = page => page.on('pageerror', error => {
      if (report.pageErrors.length < 8) report.pageErrors.push({ id: configuration.id, message: errorText(error) });
      item.pageErrorCount = (item.pageErrorCount ?? 0) + 1;
    });
    context.on('page', onPage); context.pages().forEach(onPage);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const workerURL = new URL(worker.url());
    assert.equal(workerURL.protocol, 'chrome-extension:'); assert.match(workerURL.hostname, /^[a-p]{32}$/);
    assert.equal(workerURL.pathname, '/worker.mjs');
    const extensionOrigin = `chrome-extension://${workerURL.hostname}`;
    item.installedExtensionObserved = true;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const localExtension = url.protocol === 'chrome-extension:' && url.hostname === workerURL.hostname;
      const localFixture = url.origin === fixtureOrigin && url.pathname === '/task' && !url.search;
      const localDownload = request.url().startsWith(`blob:${extensionOrigin}/`);
      if (['GET', 'HEAD'].includes(request.method()) && (localExtension || localFixture || localDownload)) return route.continue();
      report.unexpectedRequests += 1; item.unexpectedRequests = (item.unexpectedRequests ?? 0) + 1;
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => { report.unexpectedRequests += 1; item.unexpectedRequests = (item.unexpectedRequests ?? 0) + 1; socket.close(); });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${extensionOrigin}/workspace.html`);
    await page.locator('#library-list .library-empty').waitFor({ state: 'visible' });
    assert(await page.locator('#empty').isVisible());
    await chooser(page, validFile);
    await page.getByText('Workflow imported as a new library item. No actions were run.', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('heading', { name: imported.title, exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#steps .step-card').count(), 2);
    assert.equal(await page.locator('#library-list .library-item').count(), 1);
    const edited = structuredClone(imported); edited.title = `Reviewed ${configuration.id} workflow`;
    edited.steps[0].label = 'Continue after review'; edited.steps[0].note = 'Check <result> and literal [text].';
    await page.getByLabel('Name', { exact: true }).fill(edited.title);
    await page.locator('#steps .step-card').nth(0).getByLabel('Step label', { exact: true }).fill(edited.steps[0].label);
    await page.locator('#steps .step-card').nth(0).getByLabel('Notes', { exact: true }).fill(edited.steps[0].note);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Changes saved on this device.', { exact: true }).waitFor({ state: 'visible' });
    await page.reload();
    await page.getByRole('heading', { name: edited.title, exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#session-title').inputValue(), edited.title);
    assert.equal(await page.locator('#steps .step-card').nth(0).getByLabel('Step label', { exact: true }).inputValue(), edited.steps[0].label);
    assert.equal(await page.locator('#steps .step-card').nth(0).getByLabel('Notes', { exact: true }).inputValue(), edited.steps[0].note);
    await narrowLayout(page, item, configuration, 'saved-workflow');
    const parameter = page.getByLabel('Value for this run', { exact: true });
    assert.equal(await parameter.inputValue(), '');
    const privateValue = `TRANSIENT_PARAMETER_${configuration.id}`; await parameter.fill(privateValue);
    const json = await download(page, '#export-json', directories.downloads, 'workflow-json');
    assert.deepEqual(JSON.parse(json.bytes.toString('utf8')), edited);
    assert.equal(json.bytes.includes(Buffer.from(privateValue)), false); item.downloads.push(json.metadata);
    const markdown = await download(page, '#export-markdown', directories.downloads, 'markdown');
    const text = markdown.bytes.toString('utf8');
    assert(text.includes(edited.title) && text.includes(edited.steps[0].label));
    assert.equal((text.match(/^- \[ \] /gm) ?? []).length, 2);
    assert(text.includes('&lt;result&gt;')); assert.equal(text.includes('<result>'), false);
    assert.equal(text.includes(privateValue), false); item.downloads.push(markdown.metadata);
    await chooser(page, invalidFile);
    await page.locator('#status[role="alert"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#session-title').inputValue(), edited.title);
    assert.equal(await page.locator('#steps .step-card').count(), 2);
    assert.equal(await page.locator('#library-list .library-item').count(), 1);
    await page.reload();
    await page.getByRole('heading', { name: edited.title, exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Value for this run', { exact: true }).inputValue(), '');
    const preserved = await download(page, '#export-json', directories.downloads, 'workflow-json-after-rejected-import');
    assert.deepEqual(JSON.parse(preserved.bytes.toString('utf8')), edited); item.downloads.push(preserved.metadata);
    const dialog = page.waitForEvent('dialog');
    const deletion = page.getByRole('button', { name: 'Delete', exact: true }).click();
    void deletion.catch(() => {});
    const confirmation = await dialog; assert.equal(confirmation.type(), 'confirm');
    assert(confirmation.message().includes(edited.title) && confirmation.message().includes('cannot be undone'));
    await confirmation.accept(); await deletion;
    await page.locator('#library-list .library-empty').waitFor({ state: 'visible' });
    await page.reload(); await page.locator('#library-list .library-empty').waitFor({ state: 'visible' });
    assert(await page.locator('#empty').isVisible()); assert.equal(await page.locator('#library-list .library-item').count(), 0);
    await narrowLayout(page, item, configuration, 'empty-library');
    assert.equal(item.pageErrorCount ?? 0, 0); assert.equal(item.unexpectedRequests ?? 0, 0);
    checkActive(); item.status = 'passed';
  } catch (error) {
    item.error = errorText(error); item.errorEvidence = errorEvidence(error);
    item.launchFailedBeforeContext = launchAttempted && !context;
  }
  finally {
    try {
      if (context) { await bounded(closeContext(context), 10_000, 'Extension context did not close.'); closeAcknowledged = true; }
      else if (!launchAttempted) closeAcknowledged = true;
      item.cleanup.contextClosed = closeAcknowledged;
      assert(closeAcknowledged, 'Browser ownership is uncertain; retain its directory.');
      await verifyNoOwnedProcesses(owned, item.cleanup);
      await verifyScratch(); assert.deepEqual(await identity(owned), original);
      const current = await handle.stat(); assert(current.dev === original.dev && current.ino === original.ino);
      await fs.rm(owned, { recursive: true });
      await assert.rejects(fs.lstat(owned), error => error.code === 'ENOENT');
      item.cleanup.ownedDirectoryRemoved = true;
    } catch (error) { item.status = 'failed'; item.cleanup.error = errorText(error); }
    await handle.close(); item.durationMs = Date.now() - started;
    if (interrupted) { item.status = 'failed'; item.error ??= 'The bounded browser packet was interrupted.'; }
  }
}

try {
  assert.equal(process.env.CI, 'true'); assert.equal(process.platform, 'linux');
  assert(typeof scratch === 'string' && path.isAbsolute(scratch) && !/[\r\n\u0000]/.test(scratch));
  assert.equal(await fs.realpath(scratch), path.resolve(scratch)); scratchIdentity = await identity(scratch);
  scratchHandle = await fs.open(scratch, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const moduleURL = new URL(process.env.PLAYWRIGHT_MODULE);
  assert.equal(moduleURL.protocol, 'file:'); assert(!moduleURL.search && !moduleURL.hash);
  assert(fileURLToPath(moduleURL).endsWith('/node_modules/playwright/index.mjs'));
  const { chromium } = await import(moduleURL.href);
  server = createServer((request, response) => {
    report.fixtureRequests += 1;
    if (request.method !== 'GET' || request.url !== '/task') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html><html lang="en"><title>Authored Tracelet target</title><label>City<input id="city" type="text"></label><button id="continue" type="button">Continue</button></html>');
  });
  await bounded(new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }), 5000, 'Owned fixture could not listen.');
  const address = server.address(); assert(address && typeof address === 'object');
  for (const configuration of cases) {
    await journey(chromium, `http://127.0.0.1:${address.port}`, configuration);
    if (report.cases.at(-1)?.launchFailedBeforeContext) { report.stoppedAfterLaunchFailure = configuration.id; break; }
    if (interrupted || contexts.size) break;
  }
} catch (error) { report.error = errorText(error); report.errorEvidence = errorEvidence(error); }
finally {
  for (const context of contexts) {
    try { await bounded(closeContext(context), 10_000, 'Extension context remained open.'); }
    catch (error) { report.cleanup.browserError = errorText(error); }
  }
  if (server) {
    try {
      server.closeAllConnections();
      await bounded(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 5000, 'Owned fixture did not close.');
      serverClosed = true;
    } catch (error) { report.cleanup.serverError = errorText(error); }
  } else serverClosed = true;
  report.cleanup.serverClosed = serverClosed; report.cleanup.contextsClosed = contexts.size === 0;
  if (scratchHandle) { try { await verifyScratch(); report.cleanup.parentIdentityUnchanged = true; } catch (error) { report.cleanup.scratchError = errorText(error); } await scratchHandle.close(); }
  clearTimeout(workTimer);
  for (const configuration of cases) if (!report.cases.some(item => item.id === configuration.id)) report.cases.push({ id: configuration.id, status: 'unrun',
    ...(report.stoppedAfterLaunchFailure ? { reason: 'The preceding launch did not return a browser context; no repeated launch was attempted.' } : {}) });
  report.passed = report.cases.filter(item => item.status === 'passed').length;
  report.failed = report.cases.filter(item => item.status === 'failed').length;
  report.unrun = report.cases.filter(item => item.status === 'unrun').length;
  const passed = report.passed === 2 && report.failed === 0 && !report.error && !interrupted && report.pageErrors.length === 0 && report.unexpectedRequests === 0
    && serverClosed && contexts.size === 0 && report.cleanup.parentIdentityUnchanged === true;
  if (!passed) process.exitCode = 1;
  process.stdout.write('TRACELET_BROWSER_REPORT=' + JSON.stringify(report) + '\n', () => {
    if (interrupted) process.exitCode = 1;
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, interrupt);
  });
}
