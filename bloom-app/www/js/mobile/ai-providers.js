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
  // Short system prompt — the tools' own descriptions carry most of the
  // "how to behave" signal. We just nudge the model toward using them
  // instead of replying "I can't do that" like it did before tools
  // existed on mobile. The Claude/Gemini/OpenRouter providers all accept
  // this same string verbatim.
  const SYSTEM_PROMPT =
    'You are Bloom, a warm, helpful personal productivity assistant running on the user\'s Android phone. ' +
    'You have TOOLS for creating / updating / deleting calendar events, notes, and flashcard decks, ' +
    'and for starting Pomodoro focus sessions. When the user asks you to do any of these things, ' +
    "USE THE TOOLS — don't just describe what the user could do. Confirm what you did in a short friendly reply. " +
    'Keep answers concise. If a tool call fails, say so honestly and suggest what to try.';

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
      .map(m => {
        // Preserve structured content arrays (e.g. [tool_use, text] on
        // assistant turns, [tool_result, ...] on user turns) — those are
        // what the tool-loop pushes back in and they must be re-sent as
        // blocks, not flattened to a string.
        if (Array.isArray(m.content)) return { role: m.role, content: m.content };
        return { role: m.role, content: _extractText(m.content) };
      });
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

  /**
   * Claude streaming WITH tool-use loop.
   *
   * Stream cycle:
   *   1. Request with `tools` array → SSE frames arrive
   *   2. Parse frames:
   *      - content_block_start (text) → open a text block buffer
   *      - content_block_delta (text_delta) → emit stream-delta + append
   *      - content_block_start (tool_use) → open a tool_use block,
   *        remember id + name, start buffering partial JSON
   *      - content_block_delta (input_json_delta) → append to JSON buffer
   *      - content_block_stop → finalize the open block
   *      - message_delta (stop_reason) → remember stop reason
   *   3. If stop_reason === 'tool_use':
   *      a. Run each tool via _bloomAITools.executeTool
   *      b. Append assistant turn (with blocks) + user turn (tool_results)
   *         to the running messages array
   *      c. Re-request and loop
   *   4. Else → emit stream-done
   *
   * Hard cap at 8 iterations to prevent runaway tool loops on a bad model
   * response. The desktop implementation doesn't cap explicitly but it
   * runs inside an Electron main process — on a phone the cost of a
   * runaway loop is battery + data.
   */
  async function streamClaude({ messages, conversationId, signal, emit }) {
    const key = await getKey('claude');
    if (!key) throw new Error('Claude API key not configured. Add one in Settings.');
    const toolsRegistry = window._bloomAITools;
    const tools = toolsRegistry ? toolsRegistry.getAllTools() : [];

    // Clone the passed-in array — we mutate it across tool loops.
    let workingMessages = _asClaudeMessages(messages);
    const MAX_ITER = 8;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

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
          messages: workingMessages,
          tools: tools.length ? tools : undefined,
          stream: true,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Claude ${res.status}: ${txt.slice(0, 400) || res.statusText}`);
      }

      // Per-iteration state. Claude's streaming protocol emits blocks by
      // index (0..n) — we keep a sparse array of content blocks under
      // construction. On message_stop we'll know the full assistant turn.
      const blocks = []; // [{ type: 'text'|'tool_use', text?, id?, name?, _jsonBuf? }]
      let stopReason = null;

      await _consumeSSE(res.body, signal, (evt) => {
        switch (evt.type) {
          case 'content_block_start': {
            const idx = evt.index;
            const cb = evt.content_block || {};
            if (cb.type === 'tool_use') {
              blocks[idx] = { type: 'tool_use', id: cb.id, name: cb.name, input: {}, _jsonBuf: '' };
              emit('claude:tool-use', { toolName: cb.name, conversationId });
            } else if (cb.type === 'text') {
              blocks[idx] = { type: 'text', text: '' };
            } else {
              blocks[idx] = { type: cb.type || 'unknown' };
            }
            break;
          }
          case 'content_block_delta': {
            const idx = evt.index;
            const b = blocks[idx];
            if (!b) break;
            if (evt.delta?.type === 'text_delta') {
              b.text = (b.text || '') + (evt.delta.text || '');
              emit('claude:stream-delta', { text: evt.delta.text, conversationId });
            } else if (evt.delta?.type === 'input_json_delta') {
              b._jsonBuf = (b._jsonBuf || '') + (evt.delta.partial_json || '');
            }
            break;
          }
          case 'content_block_stop': {
            const b = blocks[evt.index];
            if (b?.type === 'tool_use') {
              // Parse the accumulated JSON now that the block is closed.
              try {
                b.input = b._jsonBuf ? JSON.parse(b._jsonBuf) : {};
              } catch {
                b.input = {};
              }
              delete b._jsonBuf;
            }
            break;
          }
          case 'message_delta':
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
            break;
          default:
            /* message_start / message_stop / ping / error — ignore */
        }
      });

      // No tool use: we're done.
      if (stopReason !== 'tool_use') {
        emit('claude:stream-done', { conversationId });
        return;
      }

      // Tool use: append assistant turn with all blocks, then run tools
      // and append the tool_result user turn.
      const assistantContent = blocks.filter(Boolean).map(b => {
        if (b.type === 'tool_use') {
          return { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} };
        }
        if (b.type === 'text') {
          return { type: 'text', text: b.text || '' };
        }
        return null;
      }).filter(Boolean);

      workingMessages.push({ role: 'assistant', content: assistantContent });

      const toolResults = [];
      for (const b of blocks) {
        if (!b || b.type !== 'tool_use') continue;
        const out = toolsRegistry
          ? await toolsRegistry.executeTool(b.name, b.input || {})
          : { error: 'Tool registry not loaded' };
        toolResults.push({
          type: 'tool_result',
          tool_use_id: b.id,
          // Tool results must be strings for Claude. JSON-stringify objects.
          content: typeof out === 'string' ? out : JSON.stringify(out),
        });
      }
      workingMessages.push({ role: 'user', content: toolResults });

      // Loop back — Claude will produce a follow-up turn incorporating
      // the tool results (usually a short "here's what I did" reply).
    }

    // Fell off the end of the iteration cap. Treat as done with a
    // diagnostic so the sheet closes out cleanly instead of hanging.
    emit('claude:stream-delta', { text: '\n\n(Hit tool-loop cap — stopping.)', conversationId });
    emit('claude:stream-done', { conversationId });
  }

  /**
   * Gemini streaming with functionCall loop.
   *
   * Differences from Claude/OpenRouter:
   *   - tools are `{ functionDeclarations: [...] }` with UPPERCASE type names
   *   - model returns `parts: [{ text }, { functionCall: {name, args} }]`
   *     — both can appear in the same response
   *   - tool results are sent back as `{ functionResponse: { name, response } }`
   *   - role is 'user' for user, 'model' for assistant/tool turns
   *   - the streamGenerateContent SSE format chunks parts per frame;
   *     finalizing requires watching for role+parts rather than an explicit
   *     stop_reason
   */
  async function streamGemini({ messages, conversationId, signal, emit }) {
    const key = await getKey('gemini');
    if (!key) throw new Error('Gemini API key not configured. Add one in Settings.');
    const toolsRegistry = window._bloomAITools;
    const tools = toolsRegistry ? toolsRegistry.getAllToolsForGemini() : [];

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;

    let contents = _asGeminiContents(messages);
    const MAX_ITER = 8;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const body = {
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      };
      if (tools.length) body.tools = tools;

      const res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Gemini ${res.status}: ${txt.slice(0, 400) || res.statusText}`);
      }

      const functionCalls = [];
      const modelParts = [];

      await _consumeSSE(res.body, signal, (evt) => {
        const parts = evt?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return;
        for (const p of parts) {
          if (p.text) {
            modelParts.push({ text: p.text });
            emit('claude:stream-delta', { text: p.text, conversationId });
          } else if (p.functionCall) {
            const call = { name: p.functionCall.name, args: p.functionCall.args || {} };
            functionCalls.push(call);
            modelParts.push({ functionCall: call });
            emit('claude:tool-use', { toolName: call.name, conversationId });
          }
        }
      });

      if (!functionCalls.length) {
        emit('claude:stream-done', { conversationId });
        return;
      }

      // Append model turn with all parts (text + functionCalls).
      contents.push({ role: 'model', parts: modelParts });

      // Execute and append functionResponses as a single user turn.
      const responseParts = [];
      for (const fc of functionCalls) {
        const out = toolsRegistry
          ? await toolsRegistry.executeTool(fc.name, fc.args || {})
          : { error: 'Tool registry not loaded' };
        responseParts.push({
          functionResponse: {
            name: fc.name,
            // Gemini expects `response` to be an object, not a string.
            response: typeof out === 'object' && out !== null ? out : { result: out },
          }
        });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    emit('claude:stream-delta', { text: '\n\n(Hit tool-loop cap — stopping.)', conversationId });
    emit('claude:stream-done', { conversationId });
  }

  /**
   * OpenRouter streaming with tool-calling loop (OpenAI-compatible).
   *
   * Differences from Claude:
   *   - tools is [{type:'function', function:{name, description, parameters}}]
   *   - tool_calls stream as an array under `delta.tool_calls`, with each
   *     tool_call split into fragments addressed by `index`
   *   - finish_reason === 'tool_calls' (not 'tool_use') signals a tool turn
   *   - follow-up turn is the assistant message with { tool_calls: [...] }
   *     plus one `{ role: 'tool', tool_call_id, content }` per result
   *   - not every OpenRouter-listed model supports tool calling. If the
   *     API returns 400 with a tool-related error, we surface a friendly
   *     hint that the user should pick a different model.
   */
  async function streamOpenRouter({ messages, conversationId, signal, emit }) {
    const key = await getKey('openrouter');
    if (!key) throw new Error('OpenRouter API key not configured. Add one in Settings.');
    const model = await getOpenRouterModel();
    const toolsRegistry = window._bloomAITools;
    const tools = toolsRegistry ? toolsRegistry.getAllToolsForOpenAI() : [];

    let workingMessages = _asOpenAIMessages(messages);
    const MAX_ITER = 8;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const body = {
        model,
        messages: workingMessages,
        stream: true,
      };
      if (tools.length) body.tools = tools;

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/JuanDiaz5673/BloomAPK',
          'X-Title': 'Bloom Mobile',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        // Some OR-listed models don't support tools — retry once without
        // them. The user loses tool-use, but the message still streams.
        if (tools.length && (res.status === 400 || res.status === 404) && /tool/i.test(txt)) {
          const fallback = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            signal,
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com/JuanDiaz5673/BloomAPK',
              'X-Title': 'Bloom Mobile',
            },
            body: JSON.stringify({ model, messages: workingMessages, stream: true }),
          });
          if (fallback.ok) {
            await _consumeSSE(fallback.body, signal, (evt) => {
              const delta = evt?.choices?.[0]?.delta;
              if (delta?.content) emit('claude:stream-delta', { text: delta.content, conversationId });
            });
            emit('claude:stream-delta', {
              text: '\n\n_(This OpenRouter model doesn\'t support tools — pick Claude or Gemini for calendar/notes/flashcards.)_',
              conversationId,
            });
            emit('claude:stream-done', { conversationId });
            return;
          }
        }
        throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 400) || res.statusText}`);
      }

      let textBuf = '';
      const toolCalls = []; // [{ id, name, argsBuf }] accumulated by index
      let finishReason = null;

      await _consumeSSE(res.body, signal, (evt) => {
        const choice = evt?.choices?.[0];
        if (!choice) return;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content.length) {
          textBuf += delta.content;
          emit('claude:stream-delta', { text: delta.content, conversationId });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const slot = toolCalls[idx] || (toolCalls[idx] = { id: '', name: '', argsBuf: '' });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) {
              const wasEmpty = !slot.name;
              slot.name = (slot.name || '') + tc.function.name;
              if (wasEmpty && slot.name) emit('claude:tool-use', { toolName: slot.name, conversationId });
            }
            if (tc.function?.arguments) slot.argsBuf += tc.function.arguments;
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      });

      if (finishReason !== 'tool_calls' || !toolCalls.length) {
        emit('claude:stream-done', { conversationId });
        return;
      }

      // Append the assistant turn (with tool_calls) to history.
      workingMessages.push({
        role: 'assistant',
        content: textBuf || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.argsBuf || '{}' },
        })),
      });

      // Execute each tool, append one `{role:'tool'}` message per result.
      for (const tc of toolCalls) {
        let input = {};
        try { input = tc.argsBuf ? JSON.parse(tc.argsBuf) : {}; } catch { /* ignore */ }
        const out = toolsRegistry
          ? await toolsRegistry.executeTool(tc.name, input)
          : { error: 'Tool registry not loaded' };
        workingMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof out === 'string' ? out : JSON.stringify(out),
        });
      }
      // Loop back — model usually produces a short confirmation turn.
    }

    emit('claude:stream-delta', { text: '\n\n(Hit tool-loop cap — stopping.)', conversationId });
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
