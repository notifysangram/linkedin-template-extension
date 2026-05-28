const listEl = document.getElementById("list");
const addBtn = document.getElementById("add");
const exportBtn = document.getElementById("export");
const importBtn = document.getElementById("import");
const importFile = document.getElementById("import-file");
const statusEl = document.getElementById("status");
const portkeyKeyEl = document.getElementById("portkey-key");
const virtualKeyEl = document.getElementById("virtual-key");
const modelEl = document.getElementById("model");
const replyInstructionsEl = document.getElementById("reply-instructions");
const baseUrlEl = document.getElementById("base-url");
const autoEnabledEl = document.getElementById("auto-enabled");
const resetBacklogEl = document.getElementById("reset-backlog");
const autoStatusEl = document.getElementById("auto-status");

const loadSettings = () =>
  new Promise((r) =>
    chrome.storage.local.get(
      {
        portkeyApiKey: "",
        virtualKey: "",
        baseUrl: "https://api.portkey.ai/v1",
        model: "claude-opus-4-7",
        replyInstructions: "",
      },
      r,
    ),
  );
const saveSetting = (obj) =>
  new Promise((r) => chrome.storage.local.set(obj, r));

const load = () =>
  new Promise((r) => chrome.storage.sync.get({ templates: [] }, (d) => r(d.templates)));
const save = (templates) =>
  new Promise((r) => chrome.storage.sync.set({ templates }, r));

let templates = [];

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = false;
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => (statusEl.hidden = true), 2500);
}

function render() {
  listEl.innerHTML = "";
  if (!templates.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.style.padding = "12px";
    empty.textContent = "No templates yet. Click + New to add one.";
    listEl.appendChild(empty);
    return;
  }
  templates.forEach((t, i) => {
    const wrap = document.createElement("div");
    wrap.className = "tpl";

    const name = document.createElement("input");
    name.placeholder = "Name (e.g. Recruiter reply)";
    name.value = t.name;
    name.addEventListener("input", () => {
      templates[i].name = name.value;
      save(templates);
    });

    const body = document.createElement("textarea");
    body.placeholder = "Message body. Use {{firstName}} for the recipient.";
    body.value = t.body;
    body.addEventListener("input", () => {
      templates[i].body = body.value;
      save(templates);
    });

    const actions = document.createElement("div");
    actions.className = "tpl-actions";
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      templates.splice(i, 1);
      await save(templates);
      render();
    });
    actions.appendChild(del);

    wrap.append(name, body, actions);
    listEl.appendChild(wrap);
  });
}

addBtn.addEventListener("click", async () => {
  templates.unshift({ name: "", body: "" });
  await save(templates);
  render();
  listEl.querySelector("input")?.focus();
});

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ templates }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  chrome.downloads.download(
    { url, filename: `linkedin-templates-${stamp}.json`, saveAs: true },
    () => setTimeout(() => URL.revokeObjectURL(url), 1000),
  );
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data.templates;
    if (!Array.isArray(incoming)) throw new Error("Invalid format");
    const sanitized = incoming
      .filter((t) => t && typeof t === "object")
      .map((t) => ({ name: String(t.name ?? ""), body: String(t.body ?? "") }))
      .filter((t) => t.name || t.body);
    if (!sanitized.length) throw new Error("No templates found");
    templates = sanitized.concat(templates);
    await save(templates);
    render();
    showStatus(`Imported ${sanitized.length} template(s).`);
  } catch (e) {
    showStatus(`Import failed: ${e.message}`, true);
  } finally {
    importFile.value = "";
  }
});

portkeyKeyEl.addEventListener("input", () =>
  saveSetting({ portkeyApiKey: portkeyKeyEl.value.trim() }),
);
virtualKeyEl.addEventListener("input", () =>
  saveSetting({ virtualKey: virtualKeyEl.value.trim() }),
);
modelEl.addEventListener("change", () => saveSetting({ model: modelEl.value }));
replyInstructionsEl.addEventListener("input", () =>
  saveSetting({ replyInstructions: replyInstructionsEl.value }),
);
baseUrlEl.addEventListener("input", () =>
  saveSetting({ baseUrl: baseUrlEl.value.trim() || "https://api.portkey.ai/v1" }),
);

function showAutoStatus(msg) {
  autoStatusEl.textContent = msg;
  autoStatusEl.hidden = false;
  clearTimeout(showAutoStatus._t);
  showAutoStatus._t = setTimeout(() => (autoStatusEl.hidden = true), 3000);
}

autoEnabledEl.addEventListener("change", async () => {
  if (autoEnabledEl.checked) {
    // Turning on: snapshot current unreads as backlog on next LinkedIn load.
    await saveSetting({ autoDraftEnabled: true, autoDraftNeedsBaseline: true });
    showAutoStatus("On. Open/refresh LinkedIn — current unreads become backlog.");
  } else {
    await saveSetting({ autoDraftEnabled: false });
    showAutoStatus("Auto-draft turned off.");
  }
});

resetBacklogEl.addEventListener("click", async () => {
  await saveSetting({ autoDraftNeedsBaseline: true, autoDraftProcessed: [] });
  showAutoStatus("Backlog will reset on next LinkedIn load — current unreads re-ignored.");
});

const loadAuto = () =>
  new Promise((r) => chrome.storage.local.get({ autoDraftEnabled: false }, r));

(async () => {
  const settings = await loadSettings();
  portkeyKeyEl.value = settings.portkeyApiKey;
  virtualKeyEl.value = settings.virtualKey;
  modelEl.value = settings.model;
  replyInstructionsEl.value = settings.replyInstructions;
  baseUrlEl.value = settings.baseUrl;

  const auto = await loadAuto();
  autoEnabledEl.checked = auto.autoDraftEnabled;

  templates = await load();
  if (!templates.length) {
    templates = [
      {
        name: "Thanks recruiter",
        body: "Hi {{firstName}}, thanks for reaching out! I'm not actively looking right now, but happy to stay in touch.",
      },
      {
        name: "Networking accept",
        body: "Hi {{firstName}}, great to connect! Let me know if there's anything specific you wanted to chat about.",
      },
    ];
    await save(templates);
  }
  render();
})();
