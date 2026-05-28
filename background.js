chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-template-picker") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://www.linkedin.com/")) return;
  chrome.tabs.sendMessage(tab.id, { type: "lmt:openPicker" });
});

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_BASE_URL = "https://api.portkey.ai/v1";

const getSettings = () =>
  new Promise((resolve) => {
    chrome.storage.local.get(
      {
        portkeyApiKey: "",
        virtualKey: "",
        baseUrl: DEFAULT_BASE_URL,
        model: DEFAULT_MODEL,
        replyInstructions: "",
      },
      (data) => resolve(data),
    );
  });

const CLASSIFY_SYSTEM = `You read a LinkedIn direct-message conversation and decide one thing: is the other person reaching out because they are looking for a job or a job change (e.g. asking you to refer them, applying, exploring openings, seeking a role on your team or company)?
Answer about the most recent incoming message in context of the thread. Recruiters pitching YOU a role do not count as the person looking for a job — only count it when the sender is the one seeking employment or a change.
Respond with ONLY a JSON object of the form {"job_outreach": true|false, "reason": "<one short sentence>"} and nothing else.`;

const GENERATE_SYSTEM = `You draft a short, warm, professional LinkedIn reply on behalf of Sangram. Output ONLY the reply text — no preamble, no quotes, no subject line, no explanation. Keep it to a few short sentences.

Formatting rules (always):
- Begin with "Hi <first name>," using the recipient's first name provided to you.
- End with these two lines exactly:
All the best!
Sangram

The default answer to every request is NO. Decline politely and warmly, without over-explaining:
- If the person is looking for a job or a job change (referral, applying, exploring openings, wanting a role): tell them we are not actively hiring at the moment and suggest they keep an eye on our careers page and LinkedIn page for future openings.
- For anything else (collaboration, partnership, sales, services, investment, requests of any kind): politely decline and say it isn't something we're able to take up right now. Do not commit to anything, do not offer to schedule a call.

Example (job outreach):
Hi Tiasha,

Thanks for reaching out. We are not actively hiring at the moment, but please keep an eye on our careers page and LinkedIn page for future openings.

All the best!
Sangram`;

async function callGateway(messages, maxTokens) {
  const { portkeyApiKey, virtualKey, baseUrl, model } = await getSettings();
  if (!portkeyApiKey) {
    return {
      ok: false,
      error: "Missing Portkey API key. Click the extension icon and add it under AI Settings.",
    };
  }
  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    "content-type": "application/json",
    "x-portkey-api-key": portkeyApiKey,
  };
  if (virtualKey) headers["x-portkey-virtual-key"] = virtualKey;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: model || DEFAULT_MODEL, max_tokens: maxTokens, messages }),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Gateway ${res.status}: ${text.slice(0, 300)}` };
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const text = (typeof content === "string" ? content : "").trim();
  if (!text) return { ok: false, error: "Empty response from gateway." };
  return { ok: true, text };
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return null;
}

async function classify(transcript) {
  const result = await callGateway(
    [
      { role: "system", content: CLASSIFY_SYSTEM },
      { role: "user", content: `Conversation (oldest to newest):\n${transcript}` },
    ],
    300,
  );
  if (!result.ok) return result;
  const parsed = extractJson(result.text);
  if (!parsed || typeof parsed.job_outreach === "undefined") {
    return { ok: false, error: "Could not parse classification response." };
  }
  return { ok: true, jobOutreach: !!parsed.job_outreach, reason: String(parsed.reason || "") };
}

async function generate(transcript, firstName) {
  const { replyInstructions } = await getSettings();
  const userContent = [
    `Conversation (oldest to newest):\n${transcript}`,
    firstName ? `Recipient's first name: ${firstName}` : "",
    replyInstructions ? `My reply preferences: ${replyInstructions}` : "",
    "Write my reply to the most recent message.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callGateway(
    [
      { role: "system", content: GENERATE_SYSTEM },
      { role: "user", content: userContent },
    ],
    1000,
  );
  if (!result.ok) return result;
  return { ok: true, reply: result.text };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "lmt:classify") {
    classify(msg.transcript).then(sendResponse);
    return true;
  }
  if (msg?.type === "lmt:generate") {
    generate(msg.transcript, msg.firstName).then(sendResponse);
    return true;
  }
  return false;
});
