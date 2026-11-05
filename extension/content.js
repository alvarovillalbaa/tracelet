(() => {
  if (window !== window.top || globalThis.__traceletContentInstalled) return;
  globalThis.__traceletContentInstalled = true;
  let active = null, overlay = null;
  const forbidden = new Set(["password", "hidden", "file", "submit", "reset", "image", "email", "tel"]);
  const sensitiveWords = /(?:password|passwd|passcode|secret|token|credential|one.?time|otp|credit.?card|card.?number|card.?holder|cvv|cvc|security.?code|routing|iban)/iu;
  const safeText = (value, limit) => {
    let output = String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit);
    if (/[\ud800-\udbff]$/u.test(output)) output = output.slice(0, -1);
    return output;
  };
  const currentSource = () => ({ origin: location.origin, path: location.pathname });
  const matchesSource = value => {
    const url = new URL(location.href);
    return value && Object.keys(value).length === 2 && value.origin === url.origin && value.path === url.pathname && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  };
  const send = message => chrome.runtime.sendMessage(message).then(result => {
    if (!result?.ok) stop(true);
    return result;
  }).catch(() => stop(true));
  function textWithoutValues(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest("input,textarea,select,[contenteditable],script,style,[hidden]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let text = "", node;
    while (text.length < 160 && (node = walker.nextNode())) text += node.nodeValue.slice(0, 160 - text.length);
    return text;
  }
  function labelOf(element) {
    const explicit = element.getAttribute("aria-label");
    const labels = element.labels ? [...element.labels].map(textWithoutValues).join(" ") : "";
    return safeText(explicit || labels || (element.matches("button, [role=button]") ? textWithoutValues(element) : "") || element.getAttribute("title"), 160) || element.tagName.toLowerCase();
  }
  function sensitive(element) {
    if (!(element instanceof Element) || element.isContentEditable || forbidden.has(element.type)) return true;
    const attributes = ["autocomplete", "name", "id", "aria-label", "placeholder"].map(name => element.getAttribute(name) ?? "").join(" ");
    return sensitiveWords.test(attributes) || /(?:^|\s)(?:username|current-password|new-password|one-time-code|cc-[a-z-]+)(?:\s|$)/iu.test(element.autocomplete ?? "");
  }
  function sensitiveForm(element) {
    const form = element.form || element.closest("form");
    return Boolean(form && [...form.querySelectorAll("input,textarea,select")].some(control => control.type !== "hidden" && sensitive(control)));
  }
  function visible(element) {
    if (!element.isConnected || element.closest("[hidden],[inert],[aria-hidden=true]") || !element.getClientRects().length) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    const box = element.getBoundingClientRect();
    const left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return hit === element || element.contains(hit);
  }
  function selectorOf(element) {
    if (element.id) {
      const selector = `#${CSS.escape(element.id)}`;
      if (selector.length <= 500 && document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = []; let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement ? [...current.parentElement.children].filter(child => child.tagName === current.tagName) : [current];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
      const selector = parts.join(" > ");
      if (selector.length > 500) return null;
      if (document.querySelectorAll(selector).length === 1 && document.querySelector(selector) === element) return selector;
      current = current.parentElement;
    }
    return null;
  }
  function describe(element) {
    const selector = selectorOf(element);
    return selector ? { selector, tag: element.tagName.toLowerCase(), type: safeText(element.type, 40).toLowerCase(), label: labelOf(element) } : null;
  }
  function supportedClick(element) {
    return element.matches('button[type="button"], input[type="button"], [role="button"]') && !element.closest("a[href],[download],form") && !element.matches("input[type=submit],input[type=reset]");
  }
  function supportedField(element) {
    return element.matches("input,textarea,select") && !forbidden.has(element.type) && element.type !== "button" && element.type !== "select-multiple";
  }
  function emit(kind, element, note = "") {
    if (!active || !matchesSource(active.source)) { stop(true); return; }
    const at = Math.max(0, Date.now() - active.startedAt);
    if (at > 300_000 || active.count >= 500) { stop(true); return; }
    const target = kind === "manual" ? null : describe(element);
    if (kind !== "manual" && !target) { kind = "manual"; note = "This target needs manual review; no unique supported locator was captured."; }
    const step = { id: crypto.randomUUID(), at: Math.max(active.lastAt, at), kind, label: kind === "manual" ? "Manual action" : labelOf(element), note, target };
    active.lastAt = step.at; active.count++;
    void send({ target: "worker", type: "capture-event", sessionId: active.sessionId, step });
    if (active.count >= 500) stop(true);
  }
  function onClick(event) {
    if (!active || !event.isTrusted || overlay?.contains(event.target)) return;
    const element = event.target instanceof Element ? event.target.closest("button,input,a,[role=button],summary") : null;
    if (!element || sensitive(element) || sensitiveForm(element)) return;
    if (element.matches('input[type="checkbox"],input[type="radio"]')) return;
    if (!supportedClick(element)) { emit("manual", element, "Navigation, form submission or an unsupported click must be performed manually."); return; }
    emit("click", element);
  }
  function onChange(event) {
    if (!active || !event.isTrusted || !(event.target instanceof Element) || overlay?.contains(event.target)) return;
    const element = event.target;
    if (sensitive(element) || sensitiveForm(element)) return;
    if (!supportedField(element)) { emit("manual", element, "This field needs manual input; its value was not collected."); return; }
    emit("field", element, "Supply this field's value when approving replay. No field value was recorded.");
  }
  function stop(notify = true) {
    const sessionId = active?.sessionId;
    active = null;
    overlay?.remove(); overlay = null;
    if (notify && sessionId) void send({ target: "worker", type: "stop", sessionId });
  }
  function start(message) {
    if (typeof message.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(message.sessionId) || !Number.isSafeInteger(message.startedAt) || Math.abs(Date.now() - message.startedAt) > 300_000 || !matchesSource(message.source)) throw new Error("capture_binding_invalid");
    if (active?.sessionId === message.sessionId) return { ok: true, status: "recording" };
    if (active) throw new Error("capture_already_active");
    active = { sessionId: message.sessionId, startedAt: message.startedAt, source: currentSource(), count: 0, lastAt: 0 };
    overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px";
    const shadow = overlay.attachShadow({ mode: "closed" }), button = document.createElement("button");
    button.type = "button"; button.textContent = "● Tracelet recording · Stop";
    button.style.cssText = "font:14px system-ui;padding:12px 16px;color:white;background:#9b1c31;border:2px solid white;border-radius:8px;cursor:pointer";
    button.addEventListener("click", () => stop(true)); shadow.append(button); document.documentElement.append(overlay);
    return { ok: true, status: "recording" };
  }
  function execute(message) {
    if (active) throw new Error("replay_while_recording");
    if (!matchesSource(message.source)) throw new Error("replay_source_changed");
    const step = message.step, target = step?.target;
    if (!step || !["click", "field"].includes(step.kind) || !target || typeof target.selector !== "string" || target.selector.length > 500 || !target.selector || typeof target.label !== "string" || target.label.length > 160) throw new Error("replay_step_invalid");
    let elements;
    try { elements = document.querySelectorAll(target.selector); } catch { throw new Error("replay_target_invalid"); }
    if (elements.length !== 1) throw new Error("replay_target_ambiguous");
    const element = elements[0];
    if (element.tagName.toLowerCase() !== target.tag || safeText(element.type, 40).toLowerCase() !== target.type || labelOf(element) !== target.label) throw new Error("replay_target_changed");
    if (!visible(element) || element.matches(":disabled,[aria-disabled=true]") || element.readOnly || sensitive(element) || sensitiveForm(element) || element.closest("a[href],[download]")) throw new Error("replay_target_refused");
    if (step.kind === "click") {
      if (!supportedClick(element)) throw new Error("replay_click_refused");
      element.click();
    } else {
      if (!supportedField(element) || typeof message.value !== "string" || message.value.length > 4000) throw new Error("replay_field_refused");
      if (["checkbox", "radio"].includes(element.type)) {
        if (!["true", "false"].includes(message.value)) throw new Error("replay_value_invalid");
        element.checked = message.value === "true";
      } else if (element instanceof HTMLSelectElement) {
        const option = [...element.options].find(item => item.value === message.value && !item.disabled && !item.parentElement?.disabled);
        if (!option) throw new Error("replay_value_invalid");
        element.value = message.value;
      } else {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, message.value);
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, status: "dispatched", kind: step.kind };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && !sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) || message?.target !== "content") return;
    try {
      if (message.type === "start") respond(start(message));
      else if (message.type === "stop") { stop(false); respond({ ok: true, status: "stopped" }); }
      else if (message.type === "execute") respond(execute(message));
    } catch (failure) { respond({ ok: false, error: /^capture_|^replay_/u.test(failure.message) ? failure.message : "content_operation_failed" }); }
  });
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  window.addEventListener("pagehide", () => stop(true));
})();
