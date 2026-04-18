// ─── Mobile AI providers (Phase 2) ─────────────────────────────────
//
// Streams chat responses from Claude / Gemini / OpenRouter directly
// from the WebView using `fetch` + `ReadableStream` SSE parsing.
//
// Emits events on a shared event bus (see bridge). The renderer's
// chat.js + bloom-panel.js + bloom-sheet.js all listen on these
// channels already, so porting this == AI starts working everywhere
// with zero view-code changes.
//
// Design notes / caveats:
// - Claude requires `anthropic-dangerous-direct-browser-access: true`
//   to allow requests from the Capacitor webview origin
//   (`https://localhost/`). This is Anthropic's official escape hatch
//   for in-browser SDK usage — not a security hole, since we're
//   calling from the user's own device with their own key.
// - No tool-use support yet. The desktop app wires tools into the
//   calendar / notes / study backends. Mobile won't have those
//   backends ready until Phase 3/4, so we send plain chat messages
//   for now. The streaming-delta channel the renderer listens on is
//   identical, so tools can be added later without UI changes.
// - System prompts are intentionally short on mobile. Desktop builds
//   big per-user system prompts with calendar context etc; we'll port
//   those once Phase 3 lands.

(() => {
  const PROVIDERS = {
    claude: {
      label: 'Claude Haiku 4.5',
      description: 'Anthropic · paid',
      model: 'claude-haiku-4-5-20251001',
      keyStoreKey: 'ai.claude.apiKey',
    },
    gemini: {
      label: 'Gemini 2.5 Flash',
      description: 'Google · free',
      model: 'gemini-2.5-flash',
      keyStoreKey: 'ai.gemini.apiKey',
    },
    openrouter: {
      label: 'Qwen 3 (OpenRouter)',
      description: 'Qwen · free',
      // Default model; user can pick others in Settings.
      defaultModel: 'qwen/qwen3-coder:free',
      keyStoreKey: 'ai.openrouter.apiKey',
      modelStoreKey: 'ai.openrouter.model',
    },
  };

  const ACTIVE_STORE_KEY = 'ai.activeProvider';
  const SYSTEM_PROMPT =
    'You are Bloom, a warm, helpful personal productivity assistant. ' +
    "Keep answers concise and friendly. If the user asks about features that aren't " +
    'available on mobile yet (calendar sync, notes, study decks), briefly say so ' +
    "and offer what help you can without the data.";

  // ── Store helpers ───────────────────────────────────────────────
  async function _get(key) {
    return window.electronAPI?.store?.get(key);
  }
  async function _set(key, value) {
    return window.electronAPI?.store?.set(key, value);
  }

  async function getActive() {
    return (await _get(ACTIVE_STORE_KEY)) || 'claude';
  }
  async function setActive(provider) {
    if (!PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
    await _set(ACTIVE_STORE_KEY, provider);
    return { success: true };
  }
  async function getKey(provider) {
    return _get(PROVIDERS[provider].keyStoreKey);
  }
  async function setKey(provider, key) {
    await _set(PROVIDERS[provider].keyStoreKey, key);
    return { success: true };
  }
  async function hasKey(provider) {
    return !!(await getKey(provider));
  }
  async function hasAny() {
    return (await hasKey('claude')) || (await hasKey('gemini')) || (await hasKey('openrouter'));
  }

  async function getProviderStatus() {
    const active = await getActive();
    const providers = {};
    for (const [k, info] of Object.entries(PROVIDERS)) {
      providers[k] = {
        hasKey: await hasKey(k),
        label: info.label,
        description: info.description,
      };
    }
    return { active, providers };
  }

  async function getKeyPreview(provider) {
    const k = await getKey(provider);
    if (!k || k.length < 12) return '';
    return `${k.slice(0, 7)}…${k.slice(-4)}`;
  }

  // OpenRouter lets the user pick which open-weights model to route to.
  async function getOpenRouterModel() {
    return (await _get(PROVIDERS.openrouter.modelStoreKey)) || PROVIDERS.openrouter.defaultModel;
  }
  async function setOpenRouterModel(model) {
    if (typeof model !== 'string' || !model.includes('/')) {
      throw new Error('Invalid OpenRouter model id');
    }
    await _set(PROVIDERS.openrouter.modelStoreKey, model);
    return { success: true };
  }

  // ── Message shape normalization ─────────────────────────────────
  // The renderer historically builds messages in Claude's native shape
  // (array of `{ role, content }` where content is string OR block array).
  // We normalize to text-only strings before sending to any provider.
  function _extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map(b => (typeof b === 'string' ? b : b?.text || b?.content || ''))
        .filter(Boolean)
        .join('\n');
    }
    return String(content || '');
  }

  function _asClaudeMessages(messages) {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: _extractText(m.content) }));
  }

  function _asOpenAIMessages(messages) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: _extractText(m.content) })),
    ];
  }

  function _asGeminiContents(messages) {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: _extractText(m.content) }],
      }));
  }

  // ── SSE consumer — shared across providers ─────────────────────
  async function _consumeSSE(body, signal, onEvent) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are separated by blank line (LF or CRLF).
        let sep;
        // eslint-disable-next-line no-cond-assign
        while (
          (sep = buf.indexOf('\n\n')) >= 0 ||
          (sep = buf.indexOf('\r\n\r\n')) >= 0
        ) {
          const sepLen = buf[sep] === '\r' ? 4 : 2;
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + sepLen);
          for (const line of frame.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              onEvent(JSON.parse(data));
            } catch { /* ignore malformed frames */ }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }

  // ── Provider-specific streamers ────────────────────────────────
  async function streamClaude({ messages, conversationId, signal, emit }) {
    const key = await getKey('claude');
    if (!key) throw new Error('Claude API key not configured. Add one in Settings.');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: PROVIDERS.claude.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: _asClaudeMessages(messages),
        stream: true,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Claude ${res.status}: ${txt.slice(0, 400) || res.statusText}`);
    }

    await _consumeSSE(res.body, signal, (evt) => {
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        emit('claude:stream-delta', { text: evt.delta.text, conversationId });
      }
    });
    emit('claude:stream-done', { conversationId });
  }

  async function streamGemini({ messages, conversationId, signal, emit }) {
    const key = await getKey('gemini');
    if (!key) throw new Error('Gemini API key not configured. Add one in Settings.');

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;

    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: _asGeminiContents(messages),
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${txt.slice(0, 400) || res.statusText}`);
    }

    await _consumeSSE(res.body, signal, (evt) => {
      const text = evt?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) emit('claude:stream-delta', { text, conversationId });
    });
    emit('claude:stream-done', { conversationId });
  }

  async function streamOpenRouter({ messages, conversationId, signal, emit }) {
    const key = await getKey('openrouter');
    if (!key) throw new Error('OpenRouter API key not configured. Add one in Settings.');
    const model = await getOpenRouterModel();

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/JuanDiaz5673/BloomAPK',
        'X-Title': 'Bloom Mobile',
      },
      body: JSON.stringify({
        model,
        messages: _asOpenAIMessages(messages),
        stream: true,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 400) || res.statusText}`);
    }

    await _consumeSSE(res.body, signal, (evt) => {
      const delta = evt?.choices?.[0]?.delta;
      if (delta?.content) emit('claude:stream-delta', { text: delta.content, conversationId });
    });
    emit('claude:stream-done', { conversationId });
  }

  // ── Ping-validate: cheap call to confirm the key actually works ─
  async function validateKey(provider) {
    try {
      if (provider === 'claude') {
        const key = await getKey('claude');
        if (!key) return false;
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: PROVIDERS.claude.model, max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        return res.ok;
      }
      if (provider === 'gemini') {
        const key = await getKey('gemini');
        if (!key) return false;
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
        const res = await fetch(url);
        return res.ok;
      }
      if (provider === 'openrouter') {
        const key = await getKey('openrouter');
        if (!key) return false;
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        return res.ok;
      }
    } catch { /* network flaky — surface as false */ }
    return false;
  }

  // ── Greeting generation ────────────────────────────────────────
  // Ports desktop claude-api/gemini-api's generateGreeting() onto
  // whichever provider is active + has a key. Returns
  // { title, subtitle, bloom } parsed from the model's JSON output,
  // or null if no key is set / request fails — mirrors desktop so
  // home.js's cache-on-null behavior still works.
  const GREETING_MAX_TOKENS = 200;

  function _greetingPrompt(firstName) {
    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const day = now.toLocaleDateString('en-US', { weekday: 'long' });
    const fullDate = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const nameLine = firstName
      ? `The user's name is ${firstName} — greet them by name when natural.`
      : `The user has not shared their name — keep the greeting generic. Do NOT invent a name.`;
    return `Generate a dashboard greeting.

${nameLine}

IMPORTANT — today is exactly: ${fullDate}, ${timeOfDay}. It is ${day}. Use this accurately — if it's Monday, reference the start of the week. If Friday, reference the weekend coming. Never say "wrap up the week" on a Monday.

Return ONLY a JSON object with these 3 fields:
- "title": A short welcome headline (3-6 words, creative — motivational, playful, punny, or warm. Should feel relevant to the day/time).
- "subtitle": A fun fact, inspiring quote, light joke, or productivity tip — 1-2 sentences. Be creative and different every time.
- "bloom": A short bubbly greeting from Bloom the AI assistant (1 sentence, use an emoji, be time-aware).

No markdown, no code fences — just the raw JSON object.`;
  }

  function _parseGreeting(raw) {
    if (!raw) return null;
    // Models occasionally wrap JSON in ```json fences despite the prompt.
    const stripped = String(raw).replace(/```json\s*|\s*```/g, '').trim();
    // Pull out the first {...} blob to be resilient to stray prose.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const j = JSON.parse(match[0]);
      if (!j || typeof j !== 'object') return null;
      return {
        title: typeof j.title === 'string' ? j.title : null,
        subtitle: typeof j.subtitle === 'string' ? j.subtitle : null,
        bloom: typeof j.bloom === 'string' ? j.bloom : null,
      };
    } catch { return null; }
  }

  async function _greetingViaClaude(prompt) {
    const key = await getKey('claude');
    if (!key) return null;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: PROVIDERS.claude.model,
        max_tokens: GREETING_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.content?.[0]?.text || null;
  }

  async function _greetingViaGemini(prompt) {
    const key = await getKey('gemini');
    if (!key) return null;
    // Non-streaming one-shot endpoint (no :streamGenerateContent).
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: GREETING_MAX_TOKENS, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  async function _greetingViaOpenRouter(prompt) {
    const key = await getKey('openrouter');
    if (!key) return null;
    const model = (await getOpenRouterModel()) || PROVIDERS.openrouter.defaultModel;
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: GREETING_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.choices?.[0]?.message?.content || null;
  }

  async function generateGreeting() {
    try {
      const provider = await getActive();
      if (!(await hasKey(provider))) return null;
      let firstName = null;
      try { firstName = await window.electronAPI?.store?.get('user.firstName'); } catch {}
      const prompt = _greetingPrompt(firstName);
      const raw =
        provider === 'claude' ? await _greetingViaClaude(prompt) :
        provider === 'gemini' ? await _greetingViaGemini(prompt) :
        provider === 'openrouter' ? await _greetingViaOpenRouter(prompt) :
        null;
      return _parseGreeting(raw);
    } catch (err) {
      console.warn('[ai] generateGreeting failed:', err?.message || err);
      return null;
    }
  }

  // Expose to bridge.
  window._bloomAI = {
    PROVIDERS,
    getActive, setActive,
    getKey, setKey, hasKey, hasAny,
    getProviderStatus, getKeyPreview,
    getOpenRouterModel, setOpenRouterModel,
    streamClaude, streamGemini, streamOpenRouter,
    validateKey,
    generateGreeting,
  };
})();
