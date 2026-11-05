const MAX_STEPS = 500;
const MAX_DURATION = 300_000;
const kinds = new Set(["click", "field", "manual"]);
const forbiddenTypes = new Set(["password", "hidden", "file", "submit", "reset", "image"]);

function fail(code) { throw new Error(`workflow_${code}`); }
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("object");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) fail("keys");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("object");
  }
  return value;
}
function text(value, limit, empty = false, multiline = false) {
  if (typeof value !== "string" || value.length > limit || (!empty && !value.trim()) || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || (!multiline && /[\r\n]/u.test(value))) fail("text");
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("text");
    } else if (code >= 0xdc00 && code <= 0xdfff) fail("text");
  }
  return value;
}
function time(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DURATION) fail("time");
  return value;
}

export function safeSource(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\u007f]/u.test(value)) fail("source");
  let url;
  try { url = new URL(value); } catch { fail("source"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin === "null") fail("source");
  return { origin: url.origin, path: url.pathname };
}
function source(value) {
  record(value, ["origin", "path"]);
  text(value.origin, 2048); text(value.path, 2048);
  if (!value.path.startsWith("/") || /[?#]/u.test(value.path)) fail("source");
  const normalized = safeSource(`${value.origin}${value.path}`);
  if (normalized.origin !== value.origin || normalized.path !== value.path) fail("source");
  return normalized;
}
function target(value, kind) {
  if (value === null) {
    if (kind !== "manual") fail("target");
    return null;
  }
  record(value, ["selector", "tag", "type", "label"]);
  const selector = text(value.selector, 500), tag = text(value.tag, 40).toLowerCase();
  const type = text(value.type, 40, true).toLowerCase(), label = text(value.label, 160, true);
  if (!/^[a-z][a-z0-9-]*$/u.test(tag) || !/^[a-z0-9-]*$/u.test(type) || /[<>\r\n]/u.test(selector)) fail("target");
  if (forbiddenTypes.has(type)) fail("target");
  if (kind === "field" && (!["input", "textarea", "select"].includes(tag) || (tag === "input" && type === "button"))) fail("target");
  return { selector, tag, type, label };
}

export function validateStep(value) {
  record(value, ["id", "at", "kind", "label", "note", "target"]);
  const id = text(value.id, 80), at = time(value.at);
  if (!/^[A-Za-z0-9_-]+$/u.test(id) || !kinds.has(value.kind)) fail("step");
  return { id, at, kind: value.kind, label: text(value.label, 160), note: text(value.note, 1000, true, true), target: target(value.target, value.kind) };
}
function steps(values) {
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || values.length > MAX_STEPS || Reflect.ownKeys(values).length !== values.length + 1) fail("limit");
  const ids = new Set(); let last = 0;
  const output = [];
  for (let index = 0; index < values.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("object");
    const step = validateStep(descriptor.value);
    if (ids.has(step.id) || step.at < last) fail("order");
    ids.add(step.id); last = step.at;
    output.push(step);
  }
  return output;
}

export function validateWorkflow(value) {
  record(value, ["format", "version", "title", "source", "steps"]);
  if (value.format !== "tracelet" || value.version !== 1) fail("version");
  return { format: "tracelet", version: 1, title: text(value.title, 120), source: source(value.source), steps: steps(value.steps) };
}
export function toWorkflow(session) {
  return validateWorkflow({ format: "tracelet", version: 1, title: sessionValue(session, "title"), source: sessionValue(session, "source"), steps: sessionValue(session, "steps") });
}
function sessionValue(session, key) {
  if (!session || typeof session !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(session))) fail("session");
  const descriptor = Object.getOwnPropertyDescriptor(session, key);
  if (descriptor && !("value" in descriptor)) fail("session");
  return descriptor?.value;
}
export function analyze(session) {
  const workflow = toWorkflow(session);
  const startedAt = sessionValue(session, "startedAt"), stoppedAt = sessionValue(session, "stoppedAt");
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) fail("session");
  const last = workflow.steps.at(-1)?.at ?? 0;
  if (stoppedAt !== null && stoppedAt !== undefined && !Number.isSafeInteger(stoppedAt)) fail("session");
  const durationMs = stoppedAt === null || stoppedAt === undefined ? last : stoppedAt - startedAt;
  if (!Number.isSafeInteger(durationMs) || durationMs < last || durationMs < 0) fail("session");
  return { durationMs, total: workflow.steps.length, clicks: workflow.steps.filter(step => step.kind === "click").length, fields: workflow.steps.filter(step => step.kind === "field").length, manual: workflow.steps.filter(step => step.kind === "manual").length };
}
function markdown(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/[\\`*_{}\[\]()#+.!|~-]/gu, "\\$&");
}
export function toMarkdown(session) {
  const workflow = toWorkflow(session), summary = analyze(session);
  const lines = [`# ${markdown(workflow.title)}`, "", `Source: ${markdown(workflow.source.origin + workflow.source.path)}`, "", `${summary.total} steps · ${summary.durationMs} ms · ${summary.clicks} clicks · ${summary.fields} fields · ${summary.manual} manual`, "", "Each replay step requires your approval. Field values are supplied at replay and are not included here.", ""];
  for (const step of workflow.steps) {
    lines.push(`- [ ] ${markdown(step.label)} (${step.kind}, ${step.at} ms)`);
    if (step.note) for (const line of step.note.split(/\r\n?|\n/u)) lines.push(`  ${markdown(line)}`);
  }
  return `${lines.join("\n")}\n`;
}
