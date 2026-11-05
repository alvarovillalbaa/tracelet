import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Parse source only: never import extension entry points or invoke chrome.*.
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const excluded = new Set(['.git', 'node_modules', '.vercel', 'artifacts', 'test-results', 'playwright-report']);
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Source symlinks need explicit review: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
}
walk(root); files.sort();
function read(relative) {
  const absolute = path.resolve(root, relative);
  assert(absolute.startsWith(root + path.sep), 'Reference escapes the repository.');
  const info = fs.lstatSync(absolute);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= 2 * 1024 * 1024, `Invalid source file: ${relative}`);
  return fs.readFileSync(absolute, 'utf8');
}
function reference(baseFile, target, boundary = root) {
  assert(typeof target === 'string' && target.length > 0 && !/[\r\n\\?#]/.test(target), `Invalid local reference in ${baseFile}`);
  assert(!/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('//'), `External executable or asset in ${baseFile}`);
  const absolute = target.startsWith('/') ? path.join(boundary, target.slice(1)) : path.resolve(root, path.dirname(baseFile), target);
  assert(absolute.startsWith(boundary + path.sep), `Reference escapes its source boundary in ${baseFile}`);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  read(relative);
  return relative;
}

const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.type, 'module');
assert(!packageJson.dependencies && !packageJson.devDependencies, 'The dependency-free package contract changed.');
const jsonFiles = files.filter(file => file.endsWith('.json'));
for (const file of jsonFiles) JSON.parse(read(file));

const manifest = JSON.parse(read('extension/manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '116');
assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'offscreen', 'scripting', 'storage', 'tabCapture']);
for (const key of ['host_permissions', 'optional_host_permissions', 'optional_permissions', 'web_accessible_resources', 'content_scripts']) {
  assert(manifest[key] === undefined || (Array.isArray(manifest[key]) && manifest[key].length === 0), `Unexpected capability: ${key}`);
}
assert.equal(manifest.externally_connectable, undefined, 'External messaging is outside this extension contract.');
assert.equal(manifest.background.type, 'module');
reference('extension/manifest.json', manifest.background.service_worker, path.join(root, 'extension'));
reference('extension/manifest.json', manifest.action.default_popup, path.join(root, 'extension'));
for (const resource of ['content.js', 'offscreen.html', 'workspace.html']) {
  reference('extension/manifest.json', resource, path.join(root, 'extension'));
}
for (const icon of Object.values(manifest.icons ?? {})) reference('extension/manifest.json', icon, path.join(root, 'extension'));
for (const icon of typeof manifest.action.default_icon === 'object' ? Object.values(manifest.action.default_icon) : manifest.action.default_icon ? [manifest.action.default_icon] : []) {
  reference('extension/manifest.json', icon, path.join(root, 'extension'));
}
const csp = manifest.content_security_policy?.extension_pages;
assert.equal(typeof csp, 'string', 'An explicit extension CSP is required.');
const directives = new Map();
for (const value of csp.split(';').map(value => value.trim()).filter(Boolean)) {
  const [name, ...sources] = value.split(/\s+/);
  assert(!directives.has(name), `Duplicate CSP directive: ${name}`);
  assert(sources.every(source => ["'self'", "'none'", 'data:', 'blob:'].includes(source)), `External or executable CSP source: ${name}`);
  directives.set(name, sources);
}
for (const [name, sources] of Object.entries({
  'script-src': ["'self'"], 'object-src': ["'none'"], 'connect-src': ["'none'"],
  'style-src': ["'self'"], 'base-uri': ["'none'"], 'form-action': ["'none'"], 'frame-src': ["'none'"],
})) assert.deepEqual(directives.get(name), sources, `Unexpected CSP directive: ${name}`);

const modules = files.filter(file => /\.(?:js|mjs)$/.test(file));
const imports = [];
for (const file of modules) {
  const source = read(file);
  const parsed = spawnSync(process.execPath, ['--check', path.join(root, file)], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024,
    env: { PATH: path.dirname(process.execPath) + path.delimiter + '/usr/bin:/bin', TZ: 'UTC' },
  });
  assert(!parsed.error && parsed.status === 0 && parsed.signal === null, `JavaScript syntax failed: ${file}\n${parsed.stderr || parsed.error?.message || ''}`);
  const targets = [...source.matchAll(/\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)];
  for (const match of targets) {
    const target = match[1];
    if (target.startsWith('node:')) assert(!file.startsWith('extension/'), `Node import in browser extension: ${file}`);
    else {
      assert(target.startsWith('./') || target.startsWith('../'), `Non-local import in ${file}`);
      reference(file, target, file.startsWith('extension/') ? path.join(root, 'extension') : root);
    }
    imports.push({ file, target });
  }
  if (file.startsWith('extension/')) {
    assert(!/\b(?:eval\s*\(|new\s+Function\s*\(|importScripts\s*\()/.test(source), `Executable source construction in ${file}`);
    assert(!/\.\s*(?:innerHTML|outerHTML)\s*=|\.\s*(?:insertAdjacentHTML|write|writeln)\s*\(/.test(source), `HTML sink needs review: ${file}`);
  }
}

const htmlFiles = files.filter(file => file.endsWith('.html'));
let assetReferences = 0;
for (const file of htmlFiles) {
  const html = read(file); const boundary = file.startsWith('extension/') ? path.join(root, 'extension') : path.join(root, 'site');
  assert(!/<[^>]+\son[a-z]+\s*=/i.test(html), `Inline event handler in ${file}`);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = match[1].match(/\bsrc\s*=\s*['"]([^'"]+)['"]/i);
    assert(src && match[2].trim() === '', `Inline script in ${file}`);
    reference(file, src[1], boundary); assetReferences += 1;
  }
  for (const match of html.matchAll(/<(?:img|link)\b[^>]*\b(?:src|href)\s*=\s*['"]([^'"]+)['"][^>]*>/gi)) {
    reference(file, match[1], boundary); assetReferences += 1;
  }
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*>/gi)) {
    assert(!/^\s*(?:javascript|data|blob):/i.test(match[1]), `Executable link in ${file}`);
    // Downloads are generated by the separate packaging step, never assumed to
    // exist during this source-only check. Ordinary external links are explicit.
    if (/\.html(?:#.*)?$/.test(match[1]) && !/^https?:\/\//i.test(match[1])) {
      reference(file, match[1].split('#')[0], boundary); assetReferences += 1;
    }
  }
}
assert(files.includes('extension/lib/workflow.mjs') && files.includes('site/index.html'), 'The declared extension/site source is incomplete.');
console.log(JSON.stringify({ kind: 'tracelet-static-checks', passed: true,
  javascriptFiles: modules.length, jsonFiles: jsonFiles.length, htmlFiles: htmlFiles.length,
  localAssetReferences: assetReferences, imports,
  proofLimits: 'Syntax, source references and declared capabilities only; no product module import, browser, media capture, replay or archive execution.' }));
