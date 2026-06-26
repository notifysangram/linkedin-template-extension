(() => {
  const BTN_CLASS = "lmt-btn";
  const AI_BTN_CLASS = "lmt-ai-btn";
  const PICKER_CLASS = "lmt-picker";
  const PANEL_CLASS = "lmt-ai-panel";

  const isRecruiter = () =>
    location.pathname.startsWith("/talent/") ||
    location.pathname.startsWith("/hiring/") ||
    location.pathname.startsWith("/recruiter/");

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
      // LinkedIn Recruiter containers
      form.closest(".recruiter-messaging-thread") ||
      form.closest(".thread-container") ||
      form.closest("[data-test-id='thread-view']") ||
      form.closest(".hiring-messaging-thread") ||
      document
    );
  }

  function getFirstName(form) {
    const containers = [threadOf(form), document];
    const selectors = [
      // LinkedIn
      ".msg-entity-lockup__entity-title",
      ".msg-overlay-bubble-header__title",
      ".msg-thread__link-to-profile",
      ".msg-compose__profile-row .msg-entity-lockup__entity-title",
      "h2.msg-overlay-bubble-header__title",
      ".msg-conversation-card__participant-names",
      "header .artdeco-entity-lockup__title",
      // LinkedIn Recruiter
      ".recruiter-messaging-member-name",
      ".profile-topcard-person-entity__name",
      "[data-test-id='thread-candidate-name']",
      ".hiring-messaging-header__name",
      ".thread-header__name",
      ".hiring-people-card__name",
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
    if (!thread.querySelectorAll) return "";
    // Try LinkedIn selector first, then Recruiter fallbacks
    const TRANSCRIPT_SELECTORS = [
      ".msg-s-event-listitem__body",
      // LinkedIn Recruiter — known and guessed data-test selectors
      "[data-test-messaging-thread-message-body]",
      "[data-test-message-body]",
      "[data-test-inmail-message-body]",
      "[data-test-compose-thread-message-body]",
      ".recruiter-messaging-message__body",
      ".hiring-messaging-message-body",
      "[data-test-id='message-body']",
      ".thread-message__body",
      ".inmail-message__body",
    ];
    for (const sel of TRANSCRIPT_SELECTORS) {
      const nodes = thread.querySelectorAll(sel);
      if (nodes.length) {
        return Array.from(nodes)
          .map((n) => (n.innerText || "").trim())
          .filter(Boolean)
          .slice(-12)
          .join("\n");
      }
    }

    // Recruiter fallback: walk up from the compose wrapper and look for
    // sibling elements that contain conversation text (the message scroll area).
    if (isRecruiter()) {
      let ancestor = form;
      for (let i = 0; i < 10; i++) {
        ancestor = ancestor.parentElement;
        if (!ancestor || ancestor === document.body) break;
        for (const sibling of Array.from(ancestor.children)) {
          if (sibling === form || sibling.contains(form)) continue;
          const text = (sibling.innerText || "").trim();
          if (text.length < 80) continue;
          // Filter to lines that look like message text (>15 chars, not just dates/times)
          const lines = text.split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 15 && !/^\d{1,2}:\d{2}/.test(l))
            .slice(-12);
          if (lines.length >= 1) return lines.join("\n");
        }
      }
    }

    return "";
  }

  function render(template, form) {
    return template.body.replace(/\{\{\s*firstName\s*\}\}/gi, getFirstName(form));
  }

  function insertIntoEditor(editor, text) {
    editor.focus();

    // LinkedIn Recruiter uses a plain <textarea>
    if (editor.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      ).set;
      setter.call(editor, text);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      editor.selectionStart = editor.selectionEnd = text.length;
      return;
    }

    // LinkedIn regular — contenteditable
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
    return (
      form.querySelector(".msg-form__contenteditable") ||
      // LinkedIn Recruiter — plain textarea
      form.querySelector("textarea[data-test-compose-textarea-input]") ||
      form.querySelector("textarea.compose-textarea__textarea") ||
      // fallback: any textarea, but ONLY inside the Recruiter compose wrapper
      // (avoids matching hidden textareas inside normal LinkedIn .msg-form)
      (form.hasAttribute("data-test-base-composer-textarea") ? form.querySelector("textarea") : null)
    );
  }

  const FORM_SELECTORS = [
    ".msg-form",
    // LinkedIn Recruiter (stable data-test-id)
    "[data-test-base-composer-textarea]",
  ];

  function findActiveForm() {
    const active = document.activeElement;
    for (const sel of FORM_SELECTORS) {
      const fromActive = active?.closest?.(sel);
      if (fromActive) return fromActive;
    }
    for (const sel of FORM_SELECTORS) {
      const forms = Array.from(document.querySelectorAll(sel)).filter(
        (f) => f.offsetParent !== null,
      );
      if (forms.length) return forms[forms.length - 1];
    }
    return null;
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
    const editor = editorOf(form);
    const isRecruiterForm = editor && editor.tagName === "TEXTAREA";

    if (isRecruiterForm) {
      // Recruiter: inject a stable container directly inside the compose wrapper.
      // Place buttons next to the Send button in the bottom toolbar.
      const CONTAINER_ID = "lmt-recruiter-btns";
      if (document.getElementById(CONTAINER_ID)) return; // already injected

      // Walk up from the form to find the Send button.
      let sendBtn = null;
      let ancestor = form;
      for (let i = 0; i < 8; i++) {
        ancestor = ancestor.parentElement;
        if (!ancestor) break;
        const candidates = ancestor.querySelectorAll("button");
        for (const b of candidates) {
          if (b.textContent.trim() === "Send") { sendBtn = b; break; }
        }
        if (sendBtn) break;
      }

      const container = document.createElement("div");
      container.id = CONTAINER_ID;
      container.style.cssText = "display:inline-flex;gap:6px;align-items:center;margin-right:8px;";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = BTN_CLASS;
      btn.textContent = "Templates";
      btn.title = "Insert a saved template (⌘⇧L)";
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openPicker(form, btn); });

      const aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.className = AI_BTN_CLASS;
      aiBtn.textContent = "AI Assist";
      aiBtn.title = "Classify this message and draft a reply with Claude";
      aiBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openAiPanel(form, aiBtn); });

      container.append(btn, aiBtn);

      if (sendBtn) {
        sendBtn.parentElement.insertBefore(container, sendBtn);
      } else {
        form.appendChild(container); // fallback
      }
      return;
    }

    // Regular LinkedIn: inject into the msg-form toolbar
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
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openPicker(form, btn); });
      toolbar.appendChild(btn);
    }

    if (!form.querySelector("." + AI_BTN_CLASS)) {
      const aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.className = AI_BTN_CLASS;
      aiBtn.textContent = "AI Assist";
      aiBtn.title = "Classify this message and draft a reply with Claude";
      aiBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openAiPanel(form, aiBtn); });
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
    if (location.pathname.startsWith("/messaging")) return true;
    if (isRecruiter() && (
      location.pathname.startsWith("/messaging") ||
      location.pathname.startsWith("/talent/inbox") ||
      location.pathname.startsWith("/hiring/inbox")
    )) return true;
    return !!document.querySelector(
      ".msg-conversations-container__conversations-list, .msg-conversations-container, " +
      ".recruiter-messaging-inbox, .hiring-messaging-inbox, [data-test-id='messaging-inbox']"
    );
  }

  // Anchor-driven detection: find every conversation link, dedupe by thread id,
  // and use its row (closest <li>) to judge unread state. More tolerant of
  // LinkedIn class renames than matching specific list-item classes.
  function threadRows() {
    const THREAD_PATTERNS = [
      /\/messaging\/thread\/([^/?#]+)/,
      /\/talent\/inbox\/([^/?#]+)/,
      /\/hiring\/inbox\/([^/?#]+)/,
    ];
    const anchors = Array.from(document.querySelectorAll(
      'a[href*="/messaging/thread/"], a[href*="/talent/inbox/"], a[href*="/hiring/inbox/"]'
    ));
    const seen = new Set();
    const rows = [];
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      let id = null;
      for (const pat of THREAD_PATTERNS) {
        const m = href.match(pat);
        if (m) { id = m[1]; break; }
      }
      if (!id || seen.has(id)) continue;
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
          ".msg-conversation-card__unread-count, .notification-badge--show, [class*='unread' i]," +
          ".recruiter-messaging-unread-badge, [data-test-id='unread-indicator']",
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
    return (
      document.querySelector(`a[href*="/messaging/thread/${id}"]`) ||
      document.querySelector(`a[href*="/talent/inbox/${id}"]`) ||
      document.querySelector(`a[href*="/hiring/inbox/${id}"]`)
    );
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
    const patterns = [
      /\/messaging\/thread\/([^/?#]+)/,
      /\/talent\/inbox\/[^/]+\/main\/id\/([^/?#]+)/,
      /\/talent\/inbox\/([^/?#]+)/,
      /\/hiring\/inbox\/([^/?#]+)/,
    ];
    for (const pat of patterns) {
      const m = location.pathname.match(pat);
      if (m) return m[1];
    }
    return null;
  }

  function composeIsEmpty(form) {
    const ed = editorOf(form);
    if (!ed) return false;
    if (ed.tagName === "TEXTAREA") return !ed.value.trim();
    if (ed.querySelector("p.msg-form__placeholder")) return true;
    return (ed.innerText || "").replace(/\u200b/g, "").trim().length === 0;
  }

  // The conversation partner's full name, from the thread header.
  function headerFullName(form) {
    const containers = [threadOf(form), document];
    const selectors = [
      // LinkedIn
      ".msg-entity-lockup__entity-title",
      ".msg-overlay-bubble-header__title",
      ".msg-thread__link-to-profile",
      ".msg-compose__profile-row .msg-entity-lockup__entity-title",
      "h2.msg-overlay-bubble-header__title",
      ".msg-conversation-card__participant-names",
      "header .artdeco-entity-lockup__title",
      // LinkedIn Recruiter
      ".recruiter-messaging-member-name",
      ".profile-topcard-person-entity__name",
      "[data-test-id='thread-candidate-name']",
      ".hiring-messaging-header__name",
      ".thread-header__name",
    ];
    for (const root of containers) {
      for (const sel of selectors) {
        const el = root.querySelector?.(sel);
        const full = cleanName(el?.textContent);
        if (full) return full;
      }
    }
    return "";
  }

  // Name on the most recent message group (who sent the last message).
  function lastSenderName(form) {
    const thread = threadOf(form);
    const SENDER_SELECTORS = [
      ".msg-s-message-group__name",
      ".msg-s-message-group__meta",
      // LinkedIn Recruiter — known + guessed data-test selectors
      "[data-test-message-sender]",
      "[data-test-sender-name]",
      "[data-test-messaging-member-name]",
      ".recruiter-messaging-message__sender-name",
      ".hiring-messaging-message__sender",
      "[data-test-id='message-sender-name']",
    ];
    for (const sel of SENDER_SELECTORS) {
      const nodes = thread.querySelectorAll?.(sel);
      if (nodes && nodes.length) {
        const raw = (nodes[nodes.length - 1].textContent || "").split("·")[0];
        return cleanName(raw);
      }
    }
    return "";
  }

  // true = partner sent last (reply pending), false = you sent last (skip),
  // null = couldn't tell.
  function threadNeedsReply(form) {
    const partner = headerFullName(form).toLowerCase();
    const last = lastSenderName(form).toLowerCase();
    if (partner && last) return last === partner;

    // Recruiter fallback: use message alignment.
    // Sent messages (by you) are right-aligned; received are left-aligned.
    if (isRecruiter()) {
      let ancestor = form;
      for (let i = 0; i < 10; i++) {
        ancestor = ancestor.parentElement;
        if (!ancestor || ancestor === document.body) break;
        for (const sibling of Array.from(ancestor.children)) {
          if (sibling === form || sibling.contains(form)) continue;
          if ((sibling.innerText || "").trim().length < 80) continue;
          // Collect message-like blocks (list items or any leaf-ish block with text)
          const blocks = Array.from(
            sibling.querySelectorAll('li, [role="listitem"], article')
          ).filter(el => (el.innerText || "").trim().length > 5);
          if (!blocks.length) continue;
          const lastBlock = blocks[blocks.length - 1];
          const sibRect = sibling.getBoundingClientRect();
          const blockRect = lastBlock.getBoundingClientRect();
          const offset = (blockRect.left + blockRect.width / 2) - (sibRect.left + sibRect.width / 2);
          if (Math.abs(offset) > 30) {
            // offset > 0 → right-aligned → you sent last → no reply needed
            return offset < 0;
          }
        }
      }
    }

    return null; // truly can't tell
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

    // Recruiter only — skip auto-draft on normal LinkedIn messaging.
    if (!isRecruiter()) {
      autoDraftedThreads.add(id);
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

  // ---------- Impressions Scraper ----------
  // Collects post analytics from LinkedIn Creator Analytics content page.
  // Strategy: use a MutationObserver to detect when impression labels
  // actually land in the DOM, then scrape. Also responds to a manual
  // "lmt:scrapeNow" message from the popup's "Scrape now" button.

  function isAnalyticsPage() {
    return /\/analytics\/creator\/content/.test(location.pathname);
  }

  function parseMetric(str) {
    if (!str) return 0;
    const s = String(str).replace(/,/g, '').trim();
    if (/k$/i.test(s)) return Math.round(parseFloat(s) * 1e3);
    if (/m$/i.test(s)) return Math.round(parseFloat(s) * 1e6);
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }

  // How many "Impressions" labels are currently visible.
  function countImpressionLabels() {
    let count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n =>
        /^\s*impressions?\s*$/i.test(n.textContent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    while (walker.nextNode()) count++;
    return count;
  }

  let analyticsObserver = null;
  let scrapeDebounceTimer = null;
  let lastScrapeCount = 0;   // labels found on last successful scrape
  let scrapeRunning = false;

  // Debounce: wait 800 ms of DOM quiet before actually scraping.
  function scheduleDebouncedScrape() {
    clearTimeout(scrapeDebounceTimer);
    scrapeDebounceTimer = setTimeout(() => {
      const n = countImpressionLabels();
      if (n > 0 && n !== lastScrapeCount) runAnalyticsScrape();
    }, 800);
  }

  function startAnalyticsObserver() {
    if (analyticsObserver) return;           // already watching
    if (!isAnalyticsPage()) return;
    analyticsObserver = new MutationObserver(scheduleDebouncedScrape);
    analyticsObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    LOG('analytics observer started');
    // Also try immediately in case the page is already loaded.
    scheduleDebouncedScrape();
  }

  function stopAnalyticsObserver() {
    analyticsObserver?.disconnect();
    analyticsObserver = null;
    clearTimeout(scrapeDebounceTimer);
  }

  function scheduleAnalyticsScrape() {
    if (!isAnalyticsPage()) { stopAnalyticsObserver(); return; }
    lastScrapeCount = 0;   // new URL → allow a fresh scrape
    startAnalyticsObserver();
  }

  function runAnalyticsScrape(manual = false) {
    if (!isAnalyticsPage() || !alive() || scrapeRunning) return;
    scrapeRunning = true;

    const posts = [];
    const seen  = new Set();

    // Walk every text node whose content is just "Impressions".
    // From there, navigate the surrounding DOM to find the metric value
    // and the post row it belongs to.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n =>
        /^\s*impressions?\s*$/i.test(n.textContent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });

    let textNode;
    let idx = 0;

    while ((textNode = walker.nextNode())) {
      const labelEl = textNode.parentElement;
      if (!labelEl) continue;

      // --- Find the impression number ---
      // LinkedIn puts the number either as a sibling element before the label,
      // or as a nearby ancestor's first numeric child. We try several approaches.
      let impressions = 0;
      const parent = labelEl.parentElement;

      if (parent) {
        // Approach 1: sibling elements before the label in the same parent.
        for (const kid of Array.from(parent.children)) {
          if (kid === labelEl) break;
          const t = (kid.innerText || kid.textContent || '').replace(/,/g, '').trim();
          const n = parseInt(t, 10);
          if (!isNaN(n) && n > 0) { impressions = n; break; }
        }

        // Approach 2: text node immediately before the label.
        if (!impressions) {
          const prev = labelEl.previousSibling;
          if (prev?.nodeType === Node.TEXT_NODE)
            impressions = parseMetric(prev.textContent);
        }

        // Approach 3: walk up a few levels and find the first standalone number.
        if (!impressions) {
          let up = parent;
          for (let d = 0; d < 5 && up; d++, up = up.parentElement) {
            const nums = (up.innerText || '').match(/^\s*[\d,]+\s*$/m);
            if (nums) { impressions = parseMetric(nums[0]); break; }
          }
        }
      }

      if (!impressions) continue;

      // --- Find the post row (a substantial ancestor) ---
      let row = labelEl;
      for (let depth = 0; depth < 15; depth++) {
        if (!row.parentElement) break;
        row = row.parentElement;
        const text = (row.innerText || '').trim();
        // Stop when we find a container with real prose (not just numbers/labels).
        if (
          text.length > 100 &&
          /[a-zA-Z]{3,}/.test(text)
        ) break;
      }

      // --- Extract post text preview ---
      let preview = '';
      for (const el of Array.from(row.querySelectorAll('*'))) {
        if (el.children.length !== 0) continue;
        const t = (el.innerText || '').trim();
        if (
          t.length > 20 &&
          !/^[\d,.\s%KkMmBb]+$/.test(t) &&
          !/\b(impression|reaction|comment|repost|share|view|click|like|follow)\b/i.test(t) &&
          !/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(t)
        ) {
          preview = t;
          break;
        }
      }

      // --- Extract secondary metrics (reactions / comments / shares) ---
      const allNums = ((row.innerText || '')
        .match(/\b\d[\d,]*(?:\.\d+)?[KkMm]?\b/g) || [])
        .map(parseMetric)
        .filter(n => n > 0 && n !== impressions && n <= impressions);

      // --- Extract date ---
      let date = '';
      const timeEl = row.querySelector('time[datetime]');
      if (timeEl) {
        date = (timeEl.getAttribute('datetime') || '').slice(0, 10);
      }
      if (!date) {
        const dm = (row.innerText || '').match(
          /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i
        );
        if (dm) {
          const d = new Date(dm[0]);
          if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
        }
      }

      // Dedup key: impressions + first 20 chars of preview.
      const key = `${impressions}|${preview.slice(0, 20)}`;
      if (seen.has(key)) { idx++; continue; }
      seen.add(key);

      posts.push({
        id: `lmt-${Date.now()}-${idx}`,
        preview: preview.slice(0, 150),
        impressions,
        reactions: allNums[0] || 0,
        comments:  allNums[1] || 0,
        shares:    allNums[2] || 0,
        date,
        scrapedAt: Date.now(),
      });
      idx++;
    }

    scrapeRunning = false;

    if (!posts.length) {
      LOG('impressions: 0 posts found — page may still be loading. Try scrolling or click "Scrape now".');
      if (manual) autoToast('⚠️ No posts found yet — try scrolling the analytics page first, then click Scrape now.');
      return;
    }

    lastScrapeCount = countImpressionLabels();

    try {
      chrome.storage.local.get({ 'lmt:impressions': [] }, data => {
        if (chrome.runtime.lastError || !alive()) return;
        const existing = Array.isArray(data['lmt:impressions']) ? data['lmt:impressions'] : [];

        // Merge: new data wins (fresher), then append anything old we don't have.
        const byKey = new Map();
        [...posts, ...existing].forEach(p => {
          const k = `${p.impressions}|${(p.preview || '').slice(0, 20)}`;
          if (!byKey.has(k)) byKey.set(k, p);
        });
        const merged = Array.from(byKey.values()).slice(0, 300);

        chrome.storage.local.set({ 'lmt:impressions': merged }, () => {
          if (chrome.runtime.lastError) return;
          const label = manual ? '📊 Scraped' : '📊 Auto-saved';
          autoToast(`${label} ${posts.length} posts — open the extension to view your dashboard.`);
          LOG(`impressions stored: ${posts.length} scraped, ${merged.length} total`);
          // Notify popup to refresh if it's open.
          try { chrome.runtime.sendMessage({ type: 'lmt:scrapeComplete', count: posts.length }); } catch {}
        });
      });
    } catch (e) {
      LOG('impressions store error', e);
    }
  }

  // ---------- boot ----------
  // Throttle: run scan() immediately if idle, then at most once per 500ms.
  // Pure debounce never fires when Ember keeps mutating the DOM continuously.
  let scanTimer = null;
  let lastScan = 0;
  const SCAN_INTERVAL = 500;
  let _lastObservedPath = location.pathname;
  const observer = new MutationObserver(() => {
    const now = Date.now();
    // Detect SPA navigation (pushState changes URL without firing popstate)
    if (location.pathname !== _lastObservedPath) {
      _lastObservedPath = location.pathname;
      scheduleOpenDraft();
    }
    if (now - lastScan >= SCAN_INTERVAL) {
      lastScan = now;
      scan();
    } else {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => { lastScan = Date.now(); scan(); }, SCAN_INTERVAL);
    }
  });

  function scan() {
    if (!alive()) {
      observer.disconnect();
      return;
    }
    FORM_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(injectButtons);
    });
    scheduleOpenDraft();
  }

  if (alive()) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "lmt:openPicker") {
        const form = findActiveForm();
        if (form) openPicker(form, form.querySelector("." + BTN_CLASS));
      }
      if (msg?.type === "lmt:scrapeNow") {
        if (!isAnalyticsPage()) {
          sendResponse({ ok: false, error: 'not_analytics_page' });
        } else {
          runAnalyticsScrape(true);
          sendResponse({ ok: true });
        }
        return true;
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleOpenDraft();
    });
    window.addEventListener("focus", scheduleOpenDraft);
  }

  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();

  // Kick off analytics scrape when on the right page.
  if (isAnalyticsPage()) scheduleAnalyticsScrape();

  // Re-try analytics scrape when the SPA navigates.
  window.addEventListener('popstate', scheduleAnalyticsScrape);
})();
