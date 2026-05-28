(() => {
  const BTN_CLASS = "lmt-btn";
  const AI_BTN_CLASS = "lmt-ai-btn";
  const PICKER_CLASS = "lmt-picker";
  const PANEL_CLASS = "lmt-ai-panel";

  // True only while this content script is still connected to its extension.
  // After the extension is reloaded/updated, chrome.runtime.id becomes
  // undefined and any chrome.* call throws "Extension context invalidated".
  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  const getTemplates = () =>
    new Promise((resolve) => {
      if (!alive()) return resolve(defaultTemplates());
      try {
        chrome.storage.sync.get({ templates: defaultTemplates() }, (data) => {
          if (chrome.runtime.lastError) return resolve(defaultTemplates());
          resolve(data.templates);
        });
      } catch {
        resolve(defaultTemplates());
      }
    });

  const sendBg = (msg) =>
    new Promise((resolve) => {
      if (!alive()) {
        return resolve({
          ok: false,
          error: "Extension was reloaded — refresh this LinkedIn tab and try again.",
        });
      }
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            return resolve({
              ok: false,
              error: "Extension was reloaded — refresh this LinkedIn tab and try again.",
            });
          }
          resolve(resp);
        });
      } catch {
        resolve({
          ok: false,
          error: "Extension was reloaded — refresh this LinkedIn tab and try again.",
        });
      }
    });

  function defaultTemplates() {
    return [
      {
        name: "Thanks recruiter",
        body: "Hi {{firstName}}, thanks for reaching out! I'm not actively looking right now, but I'd be happy to stay in touch.",
      },
      {
        name: "Networking accept",
        body: "Hi {{firstName}}, great to connect! Let me know if there's anything specific you wanted to chat about.",
      },
    ];
  }

  function cleanName(s) {
    if (!s) return "";
    return s
      .replace(/\s+/g, " ")
      .replace(/\(.*?\)/g, "")
      .replace(/,.*$/, "")
      .replace(/\s*[-–—]\s.*$/, "")
      .trim();
  }

  function threadOf(form) {
    return (
      form.closest(".msg-convo-wrapper") ||
      form.closest(".msg-overlay-conversation-bubble") ||
      form.closest(".scaffold-layout__detail") ||
      document
    );
  }

  function getFirstName(form) {
    const containers = [threadOf(form), document];
    const selectors = [
      ".msg-entity-lockup__entity-title",
      ".msg-overlay-bubble-header__title",
      ".msg-thread__link-to-profile",
      ".msg-compose__profile-row .msg-entity-lockup__entity-title",
      "h2.msg-overlay-bubble-header__title",
      ".msg-conversation-card__participant-names",
      "header .artdeco-entity-lockup__title",
    ];
    for (const root of containers) {
      for (const sel of selectors) {
        const el = root.querySelector?.(sel);
        const full = cleanName(el?.textContent);
        if (full) return full.split(" ")[0];
      }
    }
    return "";
  }

  function getTranscript(form) {
    const thread = threadOf(form);
    const nodes = thread.querySelectorAll
      ? thread.querySelectorAll(".msg-s-event-listitem__body")
      : [];
    const lines = Array.from(nodes)
      .map((n) => (n.innerText || "").trim())
      .filter(Boolean)
      .slice(-12);
    return lines.join("\n");
  }

  function render(template, form) {
    return template.body.replace(/\{\{\s*firstName\s*\}\}/gi, getFirstName(form));
  }

  function insertIntoEditor(editor, text) {
    editor.focus();
    const placeholder = editor.querySelector("p.msg-form__placeholder");
    if (placeholder) placeholder.remove();

    while (editor.firstChild) editor.removeChild(editor.firstChild);

    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let lastP = null;
    for (const line of lines) {
      const p = document.createElement("p");
      if (line.length === 0) {
        p.appendChild(document.createElement("br"));
      } else {
        p.textContent = line;
      }
      editor.appendChild(p);
      lastP = p;
    }

    editor.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));

    if (lastP) {
      const range = document.createRange();
      range.selectNodeContents(lastP);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function editorOf(form) {
    return form.querySelector(".msg-form__contenteditable");
  }

  function findActiveForm() {
    const active = document.activeElement;
    const fromActive = active?.closest?.(".msg-form");
    if (fromActive) return fromActive;
    const forms = Array.from(document.querySelectorAll(".msg-form")).filter(
      (f) => f.offsetParent !== null,
    );
    return forms[forms.length - 1] || null;
  }

  function placeNear(el, anchor, form) {
    let left, top;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      left = rect.left + window.scrollX;
      top = rect.bottom + window.scrollY + 4;
    } else {
      const rect = form.getBoundingClientRect();
      left = rect.left + window.scrollX + 8;
      top = rect.top + window.scrollY + 8;
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function attachDismiss(el, anchor) {
    const closeOnOutside = (e) => {
      if (!el.contains(e.target) && e.target !== anchor) cleanup();
    };
    const closeOnEsc = (e) => {
      if (e.key === "Escape") cleanup();
    };
    function cleanup() {
      el.remove();
      document.removeEventListener("mousedown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEsc, true);
    }
    setTimeout(() => {
      document.addEventListener("mousedown", closeOnOutside, true);
      document.addEventListener("keydown", closeOnEsc, true);
    }, 0);
    return cleanup;
  }

  async function openPicker(form, anchor) {
    document.querySelectorAll("." + PICKER_CLASS).forEach((p) => p.remove());

    const templates = await getTemplates();
    const picker = document.createElement("div");
    picker.className = PICKER_CLASS;

    if (!templates.length) {
      const empty = document.createElement("div");
      empty.className = "lmt-empty";
      empty.textContent = "No templates yet. Click the extension icon to add some.";
      picker.appendChild(empty);
    } else {
      templates.forEach((t) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "lmt-item";
        item.innerHTML = `<span class="lmt-name"></span><span class="lmt-preview"></span>`;
        item.querySelector(".lmt-name").textContent = t.name || "(untitled)";
        item.querySelector(".lmt-preview").textContent = render(t, form).slice(0, 80);
        item.addEventListener("click", () => {
          const editor = editorOf(form);
          if (editor) insertIntoEditor(editor, render(t, form));
          picker.remove();
        });
        picker.appendChild(item);
      });
    }

    placeNear(picker, anchor, form);
    document.body.appendChild(picker);
    attachDismiss(picker, anchor);
  }

  async function openAiPanel(form, anchor) {
    document.querySelectorAll("." + PANEL_CLASS).forEach((p) => p.remove());

    const panel = document.createElement("div");
    panel.className = PANEL_CLASS;
    panel.innerHTML = `<div class="lmt-ai-status">Reading conversation…</div>`;
    placeNear(panel, anchor, form);
    document.body.appendChild(panel);
    attachDismiss(panel, anchor);

    const transcript = getTranscript(form);
    if (!transcript) {
      panel.innerHTML = `<div class="lmt-ai-status lmt-ai-err">Couldn't read any messages in this conversation. Open a chat with messages and try again.</div>`;
      return;
    }

    panel.innerHTML = `<div class="lmt-ai-status">Asking Claude to classify…</div>`;
    const res = await sendBg({ type: "lmt:classify", transcript });

    if (!res || !res.ok) {
      panel.innerHTML = "";
      const err = document.createElement("div");
      err.className = "lmt-ai-status lmt-ai-err";
      err.textContent = res?.error || "Classification failed.";
      panel.appendChild(err);
      return;
    }

    panel.innerHTML = "";
    const verdict = document.createElement("div");
    verdict.className = "lmt-ai-verdict";
    const tag = document.createElement("span");
    tag.className = "lmt-ai-tag " + (res.jobOutreach ? "yes" : "no");
    tag.textContent = res.jobOutreach ? "Looking for a job" : "Not a job request";
    verdict.appendChild(tag);
    const reason = document.createElement("div");
    reason.className = "lmt-ai-reason";
    reason.textContent = res.reason;
    verdict.appendChild(reason);
    panel.appendChild(verdict);

    const actions = document.createElement("div");
    actions.className = "lmt-ai-actions";

    const tplBtn = document.createElement("button");
    tplBtn.type = "button";
    tplBtn.className = "lmt-ai-action";
    tplBtn.textContent = "Use a template";
    tplBtn.addEventListener("click", () => {
      panel.remove();
      openPicker(form, anchor);
    });

    const genBtn = document.createElement("button");
    genBtn.type = "button";
    genBtn.className = "lmt-ai-action primary";
    genBtn.textContent = "Generate reply";
    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      genBtn.textContent = "Generating…";
      const g = await sendBg({
        type: "lmt:generate",
        transcript,
        firstName: getFirstName(form),
      });
      if (!g || !g.ok) {
        genBtn.disabled = false;
        genBtn.textContent = "Generate reply";
        let err = panel.querySelector(".lmt-ai-generr");
        if (!err) {
          err = document.createElement("div");
          err.className = "lmt-ai-status lmt-ai-err lmt-ai-generr";
          panel.appendChild(err);
        }
        err.textContent = g?.error || "Generation failed.";
        return;
      }
      const editor = editorOf(form);
      if (editor) insertIntoEditor(editor, g.reply);
      panel.remove();
    });

    actions.append(tplBtn, genBtn);
    panel.appendChild(actions);
  }

  function injectButtons(form) {
    const toolbar =
      form.querySelector(".msg-form__left-actions") ||
      form.querySelector(".msg-form__footer") ||
      form;

    if (!form.querySelector("." + BTN_CLASS)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = BTN_CLASS;
      btn.textContent = "Templates";
      btn.title = "Insert a saved template (⌘⇧L)";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPicker(form, btn);
      });
      toolbar.appendChild(btn);
    }

    if (!form.querySelector("." + AI_BTN_CLASS)) {
      const aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.className = AI_BTN_CLASS;
      aiBtn.textContent = "AI Assist";
      aiBtn.title = "Classify this message and draft a reply with Claude";
      aiBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openAiPanel(form, aiBtn);
      });
      toolbar.appendChild(aiBtn);
    }
  }

  // ---------- Auto-draft new unread threads ----------
  // NOTE: this leans on LinkedIn's inbox DOM (conversation list + unread badges).
  // Those class names drift; if it stops finding unreads, the selectors below
  // are what to update.
  const REVIEW_PANEL_CLASS = "lmt-review";
  const MAX_PER_RUN = 8;
  let autoDraftRan = false;
  let autoDraftStarting = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => 4000 + Math.floor(Math.random() * 3000);
  const LOG = (...a) => {
    try {
      console.log("[LMT auto-draft]", ...a);
    } catch {}
  };

  function autoToast(text, ms = 4500) {
    let t = document.querySelector(".lmt-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "lmt-toast";
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.display = "block";
    clearTimeout(autoToast._t);
    autoToast._t = setTimeout(() => {
      t.style.display = "none";
    }, ms);
  }

  let lastAutoRun = 0;

  const getAutoState = () =>
    new Promise((resolve) => {
      if (!alive()) return resolve(null);
      try {
        chrome.storage.local.get(
          {
            autoDraftEnabled: false,
            autoDraftBaseline: [],
            autoDraftProcessed: [],
            autoDraftNeedsBaseline: false,
            autoDraftReview: [],
          },
          (d) => resolve(chrome.runtime.lastError ? null : d),
        );
      } catch {
        resolve(null);
      }
    });

  const setAuto = (obj) =>
    new Promise((resolve) => {
      if (!alive()) return resolve();
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch {
        resolve();
      }
    });

  function onMessagingPage() {
    return (
      location.pathname.startsWith("/messaging") ||
      !!document.querySelector(
        ".msg-conversations-container__conversations-list, .msg-conversations-container",
      )
    );
  }

  // Anchor-driven detection: find every conversation link, dedupe by thread id,
  // and use its row (closest <li>) to judge unread state. More tolerant of
  // LinkedIn class renames than matching specific list-item classes.
  function threadRows() {
    const anchors = Array.from(document.querySelectorAll('a[href*="/messaging/thread/"]'));
    const seen = new Set();
    const rows = [];
    for (const a of anchors) {
      const m = (a.getAttribute("href") || "").match(/\/messaging\/thread\/([^/?#]+)/);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, anchor: a, row: a.closest("li") || a });
    }
    return rows;
  }

  function rowIsUnread(row) {
    try {
      if (
        row.querySelector &&
        row.querySelector(
          ".msg-conversation-card__unread-count, .notification-badge--show, [class*='unread' i]",
        )
      ) {
        return true;
      }
    } catch {}
    const cls = `${row.className || ""}`;
    if (/unread/i.test(cls)) return true;
    const al = (row.getAttribute?.("aria-label") || "").toLowerCase();
    return /\bunread\b/.test(al) || /\d+\s+new\b/.test(al);
  }

  function findThreadAnchor(id) {
    return document.querySelector(`a[href*="/messaging/thread/${id}"]`);
  }

  async function waitForThreadRows(timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (threadRows().length) return;
      await sleep(500);
    }
  }

  async function waitForThread(id, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (location.pathname.includes(id)) {
        const form = findActiveForm();
        if (form && editorOf(form) && document.querySelector(".msg-s-event-listitem__body")) {
          return form;
        }
      }
      await sleep(400);
    }
    return findActiveForm();
  }

  function renderReviewPanel(review) {
    const existing = document.querySelector("." + REVIEW_PANEL_CLASS);
    if (!review || !review.length) {
      existing?.remove();
      return;
    }
    const panel = existing || document.createElement("div");
    panel.className = REVIEW_PANEL_CLASS;
    panel.innerHTML = "";

    const head = document.createElement("div");
    head.className = "lmt-review-head";
    const title = document.createElement("span");
    title.textContent = `Drafts to review (${review.length})`;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "lmt-review-clear";
    clear.textContent = "Clear";
    clear.addEventListener("click", async () => {
      await setAuto({ autoDraftReview: [] });
      renderReviewPanel([]);
    });
    head.append(title, clear);
    panel.appendChild(head);

    review.slice(0, 12).forEach((r) => {
      const row = document.createElement("a");
      row.className = "lmt-review-row";
      row.href = `/messaging/thread/${r.id}/`;
      row.textContent = `Reply to ${r.name || "(unknown)"}`;
      panel.appendChild(row);
    });

    if (!existing) document.body.appendChild(panel);
  }

  async function processNewUnreads() {
    await waitForThreadRows();
    const state = await getAutoState();
    if (!state || !state.autoDraftEnabled) return;

    const rows = threadRows();
    const unreadIds = rows.filter((r) => rowIsUnread(r.row)).map((r) => r.id);
    LOG(`rows=${rows.length} unread=${unreadIds.length}`, unreadIds);

    if (!rows.length) {
      autoToast("Auto-draft: couldn't find the conversation list. Selectors may need an update — tell Claude.");
      return;
    }

    if (state.autoDraftNeedsBaseline) {
      await setAuto({ autoDraftBaseline: unreadIds, autoDraftNeedsBaseline: false });
      LOG("baseline snapshot saved", unreadIds);
      autoToast(`Auto-draft ready. Ignoring ${unreadIds.length} current unread(s); new ones from now on get drafted.`);
      return; // snapshot the backlog; never draft for these
    }

    const baseline = new Set(state.autoDraftBaseline);
    const processed = new Set(state.autoDraftProcessed);
    const review = Array.isArray(state.autoDraftReview) ? state.autoDraftReview.slice() : [];

    const targets = unreadIds.filter((id) => !baseline.has(id) && !processed.has(id));
    LOG(`baseline=${baseline.size} processed=${processed.size} targets=${targets.length}`, targets);
    if (!targets.length) {
      if (unreadIds.length) {
        autoToast("Auto-draft: no NEW unreads (current ones are backlog/already drafted).");
      }
      renderReviewPanel(review);
      return;
    }

    autoToast(`Auto-draft: drafting ${Math.min(targets.length, MAX_PER_RUN)} new unread(s)…`, 6000);

    for (const id of targets.slice(0, MAX_PER_RUN)) {
      if (!alive()) return;
      const anchor = findThreadAnchor(id);
      if (!anchor) {
        processed.add(id);
        await setAuto({ autoDraftProcessed: Array.from(processed) });
        continue;
      }
      anchor.click();
      const form = await waitForThread(id);
      processed.add(id);
      await setAuto({ autoDraftProcessed: Array.from(processed) });

      if (form) {
        const transcript = getTranscript(form);
        if (transcript) {
          const firstName = getFirstName(form);
          const g = await sendBg({ type: "lmt:generate", transcript, firstName });
          if (g && g.ok) {
            const ed = editorOf(form);
            if (ed) insertIntoEditor(ed, g.reply);
            review.unshift({ id, name: firstName, ts: Date.now() });
            await setAuto({ autoDraftReview: review.slice(0, 50) });
            renderReviewPanel(review);
          }
        }
      }
      await sleep(jitter());
    }
  }

  async function initAutoDraft() {
    if (autoDraftRan || autoDraftStarting) return;
    autoDraftStarting = true;
    try {
      if (!alive()) {
        autoDraftStarting = false;
        return;
      }
      const state = await getAutoState();
      if (!state) {
        autoDraftStarting = false;
        return;
      }
      renderReviewPanel(state.autoDraftReview);
      if (!state.autoDraftEnabled) {
        LOG("disabled");
        autoDraftStarting = false;
        return;
      }
      if (!onMessagingPage()) {
        LOG("not on messaging page:", location.pathname);
        autoDraftStarting = false;
        return;
      }
      LOG("starting on", location.pathname);
      await sleep(2500); // let the SPA settle
      autoDraftRan = true;
      lastAutoRun = Date.now();
      await processNewUnreads();
    } catch (e) {
      LOG("error", e);
    } finally {
      if (!autoDraftRan) autoDraftStarting = false;
    }
  }

  // (The inbox list-walking functions above are kept but no longer auto-run —
  // LinkedIn's obfuscated, virtualized inbox made them unreliable. The reliable
  // path below drafts when you open a conversation, reusing the open-thread DOM.)

  // ---------- Auto-draft when you OPEN a conversation ----------
  const autoDraftedThreads = new Set();
  let autoOpenInProgress = false;
  let openDraftTimer = null;

  function currentThreadId() {
    const m = location.pathname.match(/\/messaging\/thread\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function composeIsEmpty(form) {
    const ed = editorOf(form);
    if (!ed) return false;
    if (ed.querySelector("p.msg-form__placeholder")) return true;
    return (ed.innerText || "").replace(/\u200b/g, "").trim().length === 0;
  }

  async function maybeAutoDraftOpenThread() {
    if (autoOpenInProgress || !alive()) return;
    const id = currentThreadId();
    if (!id || autoDraftedThreads.has(id)) return;

    const state = await getAutoState();
    if (!state || !state.autoDraftEnabled) return;

    const form = findActiveForm();
    if (!form) return;
    if (!composeIsEmpty(form)) {
      autoDraftedThreads.add(id); // never clobber a draft / typed text
      return;
    }
    const transcript = getTranscript(form);
    if (!transcript) return; // messages not rendered yet; retry on next mutation

    autoOpenInProgress = true;
    autoDraftedThreads.add(id);
    try {
      const firstName = getFirstName(form);
      autoToast(`Drafting a reply${firstName ? ` to ${firstName}` : ""}…`, 6000);
      const g = await sendBg({ type: "lmt:generate", transcript, firstName });
      if (g && g.ok) {
        const ed = editorOf(form);
        if (ed && composeIsEmpty(form)) {
          insertIntoEditor(ed, g.reply);
          autoToast(`Draft ready${firstName ? ` for ${firstName}` : ""} — review and hit Send.`);
        }
      } else {
        autoDraftedThreads.delete(id); // allow a retry
        autoToast(`Auto-draft failed: ${g?.error || "unknown error"}`);
      }
    } catch (e) {
      autoDraftedThreads.delete(id);
      LOG("open-draft error", e);
    } finally {
      autoOpenInProgress = false;
    }
  }

  function scheduleOpenDraft() {
    clearTimeout(openDraftTimer);
    openDraftTimer = setTimeout(() => {
      maybeAutoDraftOpenThread().catch(() => {});
    }, 1500);
  }

  // ---------- boot ----------
  const observer = new MutationObserver(() => scan());

  function scan() {
    if (!alive()) {
      observer.disconnect();
      return;
    }
    document.querySelectorAll(".msg-form").forEach(injectButtons);
    scheduleOpenDraft();
  }

  if (alive()) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "lmt:openPicker") {
        const form = findActiveForm();
        if (form) openPicker(form, form.querySelector("." + BTN_CLASS));
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleOpenDraft();
    });
    window.addEventListener("focus", scheduleOpenDraft);
  }

  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
