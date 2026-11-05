import assert from 'node:assert/strict';
import { constants, createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = process.env.TRACELET_SCRATCH;
const report = { case: 'C01', status: 'failed', stage: 'preflight', observations: {
  pageErrorCount: 0, unexpectedRequests: 0, credentialRequests: 0, fixtureRequests: 0,
  hotkeys: 0, pageErrors: [],
}, cleanup: {}, proofLimits: [
  'One headed Chromium/Xvfb installed-extension journey with OS shortcut invocation and real tabCapture.',
  'Authored loopback tab only; no real user browser, account, microphone, sound or external site.',
  'DOM replay dispatch and fixture outcomes do not establish trusted native input or third-party transaction safety.',
  'Context-close and bounded same-UID Linux process checks inspect new/reused identities for owned argv/TMPDIR/XDG markers; unchanged prelaunch identities are excluded, not a global descendant inventory.',
  'Linux Chromium does not establish macOS privacy prompts, device behavior, Chrome Web Store distribution or full product acceptance.',
] };
const end = Date.now() + 90_000;
let context, contextClosing, server, owned, ownedHandle, ownedIdentity, scratchHandle, scratchIdentity;
let launchAttempted = false, interrupted = false, extensionOrigin, fixtureOrigin, processBaseline;
const hash = value => createHash('sha256').update(value).digest('hex');
function clean(error) {
  const text = String(error?.message ?? error).replaceAll(scratch || '\u0000', '[scratch]')
    .replace(/https?:\/\/[^\s)]+/gu, '[authored-url]').replace(/chrome-extension:\/\/[^\s)]+/gu, '[extension-url]');
  return text.length <= 5400 ? text : `${text.slice(0, 400)}\n[diagnostic middle omitted]\n${text.slice(-5000)}`;
}
function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
function closeContext() {
  if (!context) return Promise.resolve();
  contextClosing ??= context.close();
  return contextClosing;
}
function interrupt() {
  interrupted = true;
  if (context) void closeContext().catch(() => {});
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, interrupt);
const workTimer = setTimeout(interrupt, 90_000);
function alive() { assert(!interrupted && Date.now() <= end, 'The 90-second capture journey was interrupted or expired.'); }
async function stage(name, action) {
  alive(); report.stage = name;
  const result = await action(); alive(); return result;
}
async function until(read, predicate, label, maximum = 10_000) {
  const stop = Math.min(end, Date.now() + maximum);
  let value;
  while (Date.now() < stop) {
    alive(); value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(label);
}
async function directoryIdentity(directory) {
  const info = await fs.lstat(directory);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Owned directory became unsafe.');
  return { dev: info.dev, ino: info.ino };
}
async function verifyOwned() {
  assert.deepEqual(await directoryIdentity(scratch), scratchIdentity);
  const parent = await scratchHandle.stat();
  assert.equal(parent.dev, scratchIdentity.dev); assert.equal(parent.ino, scratchIdentity.ino);
  assert.deepEqual(await directoryIdentity(owned), ownedIdentity);
  const held = await ownedHandle.stat();
  assert.equal(held.dev, ownedIdentity.dev); assert.equal(held.ino, ownedIdentity.ino);
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
async function snapshotProcessBaseline() {
  const deadline = Date.now() + 5000, baseline = new Set();
  const processes = (await fs.readdir('/proc')).filter(name => /^[0-9]+$/u.test(name));
  assert(processes.length <= 8192, 'Process enumeration exceeded its bound.');
  for (const pid of processes) {
    assert(Date.now() < deadline, 'Process baseline inspection exceeded its deadline.');
    try {
      if ((await fs.stat('/proc/' + pid)).uid !== process.getuid()) continue;
      const stat = await boundedProcRead('/proc/' + pid + '/stat');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u);
      assert(fields.length >= 20 && /^[0-9]+$/u.test(fields[19]), 'Process starttime was not available.');
      baseline.add(pid + ':' + fields[19]);
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  }
  return baseline;
}
async function ownedProcessScan(directory, deadline, baseline, scanned) {
  const processes = (await fs.readdir('/proc')).filter(name => /^[0-9]+$/u.test(name));
  assert(processes.length <= 8192, 'Process enumeration exceeded its bound.');
  const matches = [];
  const inside = value => value === directory || value.startsWith(directory + path.sep);
  for (const pid of processes) {
    assert(Date.now() < deadline, 'Process ownership inspection exceeded its deadline.');
    try {
      if ((await fs.stat('/proc/' + pid)).uid !== process.getuid()) continue;
      const stat = await boundedProcRead('/proc/' + pid + '/stat');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u);
      assert(fields.length >= 20 && /^[0-9]+$/u.test(fields[19]), 'Process starttime was not available.');
      const identity = pid + ':' + fields[19];
      if (baseline.has(identity)) continue;
      scanned.add(identity);
      const args = (await boundedProcRead('/proc/' + pid + '/cmdline')).split('\u0000');
      const environment = (await boundedProcRead('/proc/' + pid + '/environ')).split('\u0000');
      const argvMatch = args.some(value => inside(value) || (/^--[a-zA-Z0-9_-]+=/u.test(value) && inside(value.slice(value.indexOf('=') + 1))));
      const environmentMatch = environment.some(entry => {
        const equals = entry.indexOf('=');
        const key = entry.slice(0, equals);
        return equals > 0 && (key === 'TMPDIR' || /^XDG_[A-Z0-9_]+$/u.test(key)) && inside(entry.slice(equals + 1));
      });
      if (argvMatch || environmentMatch) {
        const current = await boundedProcRead('/proc/' + pid + '/stat');
        const currentFields = current.slice(current.lastIndexOf(')') + 2).trim().split(/\s+/u);
        if (currentFields[19] === fields[19]) matches.push(pid + ':' + fields[19]);
      }
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
    }
  }
  return matches;
}
async function verifyNoOwnedProcesses(directory, cleanup, baseline) {
  const deadline = Date.now() + 5000, observed = new Set(), scanned = new Set();
  const proof = cleanup.processOwnership = { baselinePIDs: baseline?.size ?? null, newPIDsScanned: 0,
    observedPIDs: 0, remainingPIDs: null, uncertain: false, passed: false };
  try {
    assert(baseline instanceof Set, 'The prelaunch process baseline was not verified.');
    while (Date.now() < deadline) {
      const remaining = await bounded(ownedProcessScan(directory, deadline, baseline, scanned), Math.max(1, deadline - Date.now()), 'Process ownership inspection exceeded its deadline.');
      remaining.forEach(value => observed.add(value));
      proof.newPIDsScanned = scanned.size; proof.observedPIDs = observed.size; proof.remainingPIDs = remaining.length;
      if (!remaining.length) { proof.passed = true; return; }
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
    throw new Error('Owned browser processes remained after context close.');
  } catch (error) { proof.newPIDsScanned = scanned.size; proof.uncertain = true; throw error; }
}
async function newExtensionPage(filename, previous = new Set()) {
  return until(async () => context.pages().find(page => !page.isClosed() && !previous.has(page)
    && page.url().split('?')[0].split('#')[0] === `${extensionOrigin}/${filename}`), Boolean,
  `The genuine extension ${filename} page was not exposed by Chromium.`, 10_000);
}
async function toolbar(fixture) {
  await fixture.bringToFront();
  const previous = new Set(context.pages());
  await promisify(execFile)('xdotool', ['key', '--clearmodifiers', 'alt+shift+r'], {
    timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 8192,
  });
  report.observations.hotkeys++;
  return newExtensionPage('popup.html', previous);
}
async function download(page, button, downloads, maximum) {
  const [item] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), page.locator(button).click()]);
  assert.equal(await item.failure(), null, 'The actual browser download failed.');
  const actual = await fs.realpath(await item.path());
  assert(actual.startsWith((await fs.realpath(downloads)) + path.sep), 'Download escaped the owned directory.');
  const before = await fs.lstat(actual);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= maximum, 'Unexpected download shape.');
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(actual)) {
    bytes += chunk.length; assert(bytes <= maximum); digest.update(chunk);
  }
  const after = await fs.lstat(actual);
  for (const key of ['dev', 'ino', 'size', 'mtimeMs']) assert.equal(after[key], before[key], 'Download changed while being read.');
  assert.equal(bytes, before.size);
  return { path: actual, bytes, sha256: digest.digest('hex'), suggestedFilename: item.suggestedFilename() };
}

async function journey() {
  assert.equal(process.env.CI, 'true'); assert.equal(process.platform, 'linux');
  assert(process.env.DISPLAY, 'A real Xvfb display is required.');
  assert(typeof scratch === 'string' && path.isAbsolute(scratch) && !/[\r\n\u0000]/u.test(scratch));
  assert.equal(await fs.realpath(scratch), path.resolve(scratch));
  scratchIdentity = await directoryIdentity(scratch);
  scratchHandle = await fs.open(scratch, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  owned = await fs.mkdtemp(path.join(scratch, 'tracelet-C01-'));
  ownedHandle = await fs.open(owned, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const held = await ownedHandle.stat(); ownedIdentity = { dev: held.dev, ino: held.ino };
  const dirs = Object.fromEntries(['profile', 'downloads', 'tmp', 'config', 'cache'].map(name => [name, path.join(owned, name)]));
  for (const directory of Object.values(dirs)) await fs.mkdir(directory, { mode: 0o700 });
  const moduleURL = new URL(process.env.PLAYWRIGHT_MODULE);
  assert.equal(moduleURL.protocol, 'file:'); assert(!moduleURL.search && !moduleURL.hash);
  assert(fileURLToPath(moduleURL).endsWith('/node_modules/playwright/index.mjs'));
  const { chromium } = await import(moduleURL.href);
  server = createServer((request, response) => {
    report.observations.fixtureRequests++;
    if (request.method !== 'GET' || !['/task', '/favicon.ico'].includes(request.url)) { response.writeHead(404); response.end(); return; }
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Authored Tracelet capture</title><body><h1>Capture fixture</h1><button id="continue" type="button">Continue</button><label>Project<input id="project" type="text" autocomplete="off"></label><output id="count">0</output><script>let count=0;document.querySelector("#continue").addEventListener("click",()=>{document.querySelector("#count").textContent=String(++count)});</script></body></html>');
  });
  await bounded(new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }), 5000, 'Owned fixture could not listen.');
  fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
  await stage('launch-installed-extension', async () => {
    report.observations.temporaryRootBytes = Buffer.byteLength(dirs.tmp);
    assert(report.observations.temporaryRootBytes + 64 < 108, 'Owned temporary path leaves insufficient room for Chromium socket names.');
    processBaseline = await bounded(snapshotProcessBaseline(), 5000, 'Process baseline inspection exceeded its deadline.');
    report.observations.processBaselinePIDs = processBaseline.size;
    launchAttempted = true;
    context = await chromium.launchPersistentContext(dirs.profile, {
      channel: 'chromium', headless: false, acceptDownloads: true, downloadsPath: dirs.downloads,
      viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false, serviceWorkers: 'allow', timeout: 20_000,
      args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`],
      env: { ...process.env, TMPDIR: dirs.tmp, XDG_CONFIG_HOME: dirs.config, XDG_CACHE_HOME: dirs.cache },
    });
    context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(10_000);
    report.observations.browserVersion = context.browser()?.version() ?? null;
  });
  const onPage = page => page.on('pageerror', error => {
    report.observations.pageErrorCount++;
    if (report.observations.pageErrors.length < 4) report.observations.pageErrors.push({ message: clean(error).slice(0, 384), sha256: hash(String(error.message)) });
  });
  context.on('page', onPage); context.pages().forEach(onPage);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const workerURL = new URL(worker.url());
  assert.equal(workerURL.protocol, 'chrome-extension:'); assert.match(workerURL.hostname, /^[a-p]{32}$/u); assert.equal(workerURL.pathname, '/worker.mjs');
  extensionOrigin = `chrome-extension://${workerURL.hostname}`;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), headers = await request.allHeaders();
    if (headers.authorization || headers.cookie) { report.observations.credentialRequests++; return route.abort('blockedbyclient'); }
    const extensionRead = url.origin === 'null' && url.protocol === 'chrome-extension:' && url.hostname === workerURL.hostname;
    const fixtureRead = url.origin === fixtureOrigin && ['/task', '/favicon.ico'].includes(url.pathname) && !url.search;
    const localBlob = request.url().startsWith(`blob:${extensionOrigin}/`);
    if (['GET', 'HEAD'].includes(request.method()) && (extensionRead || fixtureRead || localBlob)) return route.continue();
    report.observations.unexpectedRequests++; return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => { report.observations.unexpectedRequests++; socket.close(); });
  const fixture = context.pages()[0] ?? await context.newPage();
  await stage('open-authored-tab', async () => {
    const response = await fixture.goto(`${fixtureOrigin}/task`); assert.equal(response.status(), 200);
    assert.equal(await fixture.locator('#count').textContent(), '0');
  });
  await stage('invoke-start-popup-by-os-shortcut', async () => {
    const popup = await toolbar(fixture);
    await popup.getByText('Visible content becomes part of the video.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await popup.locator('#current-site').textContent(), `${fixtureOrigin}/task`);
    await popup.getByRole('button', { name: 'Start recording', exact: true }).click();
    await until(() => worker.evaluate(() => chrome.action.getBadgeText({})), value => value === 'REC', 'Real recording badge was not acknowledged.');
    await until(async () => popup.isClosed(), Boolean, 'The recording popup did not close after actual capture started.');
    await fixture.locator('html > div').waitFor({ state: 'visible' });
    report.observations.toolbarCaptureStarted = true;
    report.observations.inPageIndicatorVisible = true;
  });
  const originalValue = 'Authored capture project', replayValue = 'Explicit replay parameter';
  await stage('record-trusted-click-and-field-change', async () => {
    await fixture.getByRole('button', { name: 'Continue', exact: true }).click();
    await fixture.keyboard.press('Tab');
    assert.equal(await fixture.locator('#project').evaluate(element => element === document.activeElement), true);
    await fixture.keyboard.type(originalValue);
    await fixture.keyboard.press('Tab');
    assert.equal(await fixture.locator('#project').inputValue(), originalValue);
    assert.equal(await fixture.locator('#count').textContent(), '1');
  });
  let workspace;
  await stage('stop-through-actual-toolbar-and-open-review', async () => {
    const popup = await toolbar(fixture), previous = new Set(context.pages());
    await popup.getByRole('button', { name: 'Stop & review', exact: true }).click();
    workspace = await newExtensionPage('workspace.html', previous);
    await workspace.locator('#editor').waitFor({ state: 'visible' });
    assert.equal(await workspace.locator('#session-kind').textContent(), 'RECORDING & TASKS');
    assert.equal(await workspace.locator('#steps .step-card').count(), 2);
    assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '');
    report.observations.capturedSteps = 2;
  });
  await stage('decode-and-play-real-recorded-video', async () => {
    await workspace.locator('#video-section').waitFor({ state: 'visible' });
    await workspace.waitForFunction(() => { const video = document.querySelector('#video'); return video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0 && !video.error; });
    const video = workspace.locator('#video');
    const metadata = await video.evaluate(element => ({ width: element.videoWidth, height: element.videoHeight, duration: Number.isFinite(element.duration) ? element.duration : null, indefiniteDuration: element.duration === Infinity }));
    assert(metadata.duration > 0 || metadata.indefiniteDuration);
    await video.focus(); await video.press('Space');
    await workspace.waitForFunction(() => { const video = document.querySelector('#video'); return !video.error && video.currentTime > 0; });
    const playedTime = await video.evaluate(element => element.currentTime);
    assert(playedTime > 0);
    report.observations.video = { ...metadata, playedTime };
    const file = await download(workspace, '#download-video', dirs.downloads, 100 * 1024 * 1024);
    const handle = await fs.open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const header = Buffer.alloc(4); assert.equal((await handle.read(header, 0, 4, 0)).bytesRead, 4); assert.equal(header.toString('hex'), '1a45dfa3'); }
    finally { await handle.close(); }
    report.observations.videoDownload = { bytes: file.bytes, sha256: file.sha256, webmHeader: '1a45dfa3' };
  });
  const title = 'Reviewed C01 recording';
  await stage('edit-save-and-reload-recorded-session', async () => {
    await workspace.getByLabel('Name', { exact: true }).fill(title);
    await workspace.locator('#steps .step-card').nth(0).getByLabel('Notes', { exact: true }).fill('Check the authored result before continuing.');
    await workspace.getByRole('button', { name: 'Save changes', exact: true }).click();
    await workspace.getByText('Changes saved on this device.', { exact: true }).waitFor({ state: 'visible' });
    await workspace.reload();
    await workspace.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' });
    assert.equal(await workspace.locator('#steps .step-card').count(), 2);
    assert.equal(await workspace.locator('#steps .step-card').nth(0).getByLabel('Notes', { exact: true }).inputValue(), 'Check the authored result before continuing.');
    const file = await download(workspace, '#export-json', dirs.downloads, 256 * 1024);
    const bytes = await fs.readFile(file.path), workflow = JSON.parse(bytes.toString('utf8'));
    assert.equal(workflow.title, title); assert.deepEqual(workflow.steps.map(step => step.kind), ['click', 'field']);
    assert.equal(workflow.steps[0].target.label, 'Continue'); assert.equal(workflow.steps[1].target.label, 'Project');
    assert.equal(bytes.includes(Buffer.from(originalValue)), false);
    assert(workflow.steps.every(step => !Object.hasOwn(step, 'value') && !Object.hasOwn(step.target, 'value')));
    report.observations.workflowDownload = { bytes: file.bytes, sha256: file.sha256, valuesAbsent: true };
    report.observations.savedEditsSurvivedReload = true;
  });
  await stage('bind-original-tab-through-actual-toolbar', async () => {
    const popup = await toolbar(fixture), previous = new Set(context.pages());
    await popup.getByRole('button', { name: /Use this tab for tasks/u }).click();
    workspace = await newExtensionPage('workspace.html', previous);
    await workspace.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' });
    await workspace.getByText('PAGE MATCHES', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await fixture.locator('#count').textContent(), '1');
    assert.equal(await fixture.locator('#project').inputValue(), originalValue);
    report.observations.bindingObserved = true;
  });
  await stage('approve-one-recorded-click', async () => {
    await workspace.getByRole('button', { name: 'Run this click ↗', exact: true }).click();
    await workspace.getByText('Action dispatched. Check the selected page before approving another step.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await fixture.locator('#count').textContent(), '2');
    assert.equal(await fixture.locator('#project').inputValue(), originalValue);
    report.observations.clickReplayObserved = true;
  });
  await stage('approve-one-ephemeral-field-parameter', async () => {
    await workspace.getByLabel('Value for this run', { exact: true }).fill(replayValue);
    await workspace.getByRole('button', { name: 'Fill this field ↗', exact: true }).click();
    await until(() => fixture.locator('#project').inputValue(), value => value === replayValue, 'The individually approved field did not change.');
    assert.equal(await fixture.locator('#count').textContent(), '2');
    await until(() => workspace.getByLabel('Value for this run', { exact: true }).inputValue(), value => value === '', 'The transient parameter was not cleared.');
    const file = await download(workspace, '#export-json', dirs.downloads, 256 * 1024);
    assert.equal((await fs.readFile(file.path)).includes(Buffer.from(replayValue)), false);
    report.observations.fieldReplayObserved = true;
    report.observations.replayValueAbsentFromExport = true;
  });
  assert.equal(report.observations.pageErrorCount, 0); assert.equal(report.observations.unexpectedRequests, 0); assert.equal(report.observations.credentialRequests, 0);
  alive(); report.status = 'passed'; report.stage = 'complete';
}

let journeySettled = false;
const execution = journey().finally(() => { journeySettled = true; });
try { await bounded(execution, 90_000, 'The complete capture journey exceeded 90 seconds.'); }
catch (error) { report.error = clean(error); if (!journeySettled) interrupt(); }
finally {
  clearTimeout(workTimer);
  if (!journeySettled) {
    try { await bounded(execution, 6000, 'The interrupted capture journey did not settle before cleanup.'); }
    catch (error) { if (!journeySettled) report.cleanup.journeyError = clean(error); }
  }
  report.cleanup.journeySettled = journeySettled;
  try {
    if (context) { await bounded(closeContext(), 12_000, 'The real browser context did not close.'); report.cleanup.contextClosed = true; }
    else report.cleanup.contextClosed = !launchAttempted;
  } catch (error) { report.cleanup.browserError = clean(error); }
  if (server) {
    try { server.closeAllConnections(); await bounded(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 5000, 'The owned HTTP fixture did not close.'); report.cleanup.serverClosed = true; }
    catch (error) { report.cleanup.serverError = clean(error); }
  } else report.cleanup.serverClosed = true;
  try {
    if (owned && journeySettled && report.cleanup.contextClosed && report.cleanup.serverClosed) {
      await verifyOwned(); await verifyNoOwnedProcesses(owned, report.cleanup, processBaseline); await verifyOwned();
      await fs.rm(owned, { recursive: true });
      await assert.rejects(fs.lstat(owned), error => error.code === 'ENOENT'); report.cleanup.ownedDirectoryRemoved = true;
    } else if (owned) report.cleanup.retainedBecauseCleanupUncertain = true;
  } catch (error) { report.cleanup.directoryError = clean(error); }
  await ownedHandle?.close(); await scratchHandle?.close();
  if (interrupted || report.error || !journeySettled || report.observations.pageErrorCount || report.observations.unexpectedRequests || report.observations.credentialRequests || !report.cleanup.contextClosed || !report.cleanup.serverClosed || !report.cleanup.ownedDirectoryRemoved) report.status = 'failed';
  report.interrupted = interrupted;
  const output = JSON.stringify(report); assert(Buffer.byteLength(output) <= 16 * 1024, 'Capture report exceeded its finite bound.');
  const stdoutTimer = setTimeout(() => { process.stdout.destroy(); process.exit(1); }, 2000);
  process.stdout.write(`TRACELET_CAPTURE_REPORT=${output}\n`, () => {
    clearTimeout(stdoutTimer);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, interrupt);
    process.exitCode = report.status === 'passed' && !interrupted ? 0 : 1;
  });
}
