// ─── Mobile AI tools — function calling for Bloom ───────────────────
//
// Port of the desktop `src/main/tools/` registry (calendar-tools.js,
// notes-tools.js, study-tools.js). Each tool's `input_schema` is plain
// JSON Schema so the Claude format ports 1:1; `ai-providers.js` converts
// to OpenAI / Gemini shapes at request time.
//
// Executors run INSIDE the WebView and dispatch through the same
// `window.electronAPI.*` surface the views use, so a model-driven
// "create calendar event" is indistinguishable from a user-driven one —
// same Google API call, same live-refresh event bus, same error paths.
//
// Design notes:
// - Tools that read data (get_upcoming_events, list_notes, list_flashcard_decks)
//   return trimmed payloads. The model does not need Drive file modifiedTime
//   precision; shipping every field back is just tokens wasted.
// - Tools that write data dispatch the matching `bloom:*-changed` CustomEvent
//   so the corresponding view (calendar, study, notes) repaints live without
//   the user having to navigate away and back. Desktop does this via Electron
//   IPC broadcast; we do it via DOM events on `window`.
// - All executors are defensive about the AI emitting slightly-wrong input.
//   Naive datetimes (no TZ offset) get rescued. Empty cards get filtered.
//   Unknown deck/event ids surface as `{ error: ... }` (visible to the model,
//   never a raw throw).

(() => {
  // ── Helpers ─────────────────────────────────────────────────────

  /**
   * Google Calendar's events.insert requires `dateTime` to carry a timezone
   * offset (or a separate `timeZone` field, which we don't send). The AI
   * providers sometimes emit naive datetimes like "2026-04-18T10:00:00"
   * despite the schema description — this helper appends the device's
   * local offset so the API call succeeds.
   */
  function _ensureTzOffset(dt) {
    if (!dt || typeof dt !== 'string') return dt;
    const s = dt.trim();
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
    const tzMin = -new Date().getTimezoneOffset();
    const sign = tzMin >= 0 ? '+' : '-';
    const absMin = Math.abs(tzMin);
    const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
    const mm = String(absMin % 60).padStart(2, '0');
    return `${s}${sign}${hh}:${mm}`;
  }

  function _dispatch(eventName, detail) {
    try { window.dispatchEvent(new CustomEvent(eventName, { detail })); } catch { /* ignore */ }
  }

  function _api() {
    return window.electronAPI;
  }

  // ── Tool schemas (Claude-format; other providers convert from this) ─
  // Descriptions kept terse — every word is paid for on every request.
  // The model already knows Markdown, ISO 8601, and what flashcards are;
  // we don't need to teach it those. Only the app-specific contract
  // (which tool to use when, what id to pass) earns its tokens here.
  const TOOLS = [
    // ── CALENDAR ──────────────────────────────────────────────────
    {
      name: 'get_upcoming_events',
      description: 'Read upcoming Google Calendar events.',
      input_schema: {
        type: 'object',
        properties: {
          days_ahead: { type: 'number', description: 'Days to look ahead (default 7)' }
        }
      }
    },
    {
      name: 'create_calendar_event',
      description: 'Create event on primary Google Calendar.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          start_datetime: { type: 'string', description: 'ISO 8601 with tz offset, e.g. 2026-04-19T13:00:00-04:00' },
          end_datetime: { type: 'string', description: 'ISO 8601 with tz offset' },
          description: { type: 'string' },
          location: { type: 'string' }
        },
        required: ['summary', 'start_datetime', 'end_datetime']
      }
    },
    {
      name: 'update_calendar_event',
      description: 'Update event by id. Pass only fields to change.',
      input_schema: {
        type: 'object',
        properties: {
          event_id: { type: 'string' },
          summary: { type: 'string' },
          start_datetime: { type: 'string' },
          end_datetime: { type: 'string' },
          description: { type: 'string' },
          location: { type: 'string' }
        },
        required: ['event_id']
      }
    },
    {
      name: 'delete_calendar_event',
      description: 'Delete event by id.',
      input_schema: {
        type: 'object',
        properties: { event_id: { type: 'string' } },
        required: ['event_id']
      }
    },

    // ── NOTES ─────────────────────────────────────────────────────
    {
      name: 'list_notes',
      description: 'List notes (id, title, modifiedTime). Call before get_note / update_note.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'create_note',
      description: 'Create a Markdown note.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string', description: 'Markdown body' }
        },
        required: ['title', 'content']
      }
    },
    {
      name: 'get_note',
      description: 'Read a note by id (returns Markdown).',
      input_schema: {
        type: 'object',
        properties: { note_id: { type: 'string' } },
        required: ['note_id']
      }
    },
    {
      name: 'update_note',
      description: 'Update note. Content REPLACES (not merges) — pass the full new body.',
      input_schema: {
        type: 'object',
        properties: {
          note_id: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['note_id']
      }
    },
    {
      name: 'delete_note',
      description: 'Delete a note (Drive trash).',
      input_schema: {
        type: 'object',
        properties: { note_id: { type: 'string' } },
        required: ['note_id']
      }
    },

    // ── STUDY / FLASHCARDS ────────────────────────────────────────
    {
      name: 'create_flashcards_from_text',
      description: 'Create a deck with cards. 5–20 self-contained Q/A pairs.',
      input_schema: {
        type: 'object',
        properties: {
          deck_name: { type: 'string' },
          cards: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                front: { type: 'string' },
                back: { type: 'string' }
              },
              required: ['front', 'back']
            }
          }
        },
        required: ['deck_name', 'cards']
      }
    },
    {
      name: 'add_flashcard_to_deck',
      description: 'Add one card to existing deck.',
      input_schema: {
        type: 'object',
        properties: {
          deck_id: { type: 'string' },
          front: { type: 'string' },
          back: { type: 'string' }
        },
        required: ['deck_id', 'front', 'back']
      }
    },
    {
      name: 'list_flashcard_decks',
      description: 'List decks (id, name, counts).',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'start_pomodoro',
      description: 'Start a Pomodoro focus session.',
      input_schema: {
        type: 'object',
        properties: {
          duration_min: { type: 'number', description: 'Minutes (omit for user default)' }
        }
      }
    }
  ];

  // ── Executors ────────────────────────────────────────────────────

  async function _executeCalendar(name, input) {
    const api = _api();
    switch (name) {
      case 'get_upcoming_events': {
        const days = Math.max(1, Math.min(90, Number(input.days_ahead) || 7));
        const events = await api.google.getUpcomingEvents(days);
        // Trim down to fields the model actually needs — saves tokens + is
        // easier for it to skim. id is essential for follow-up updates.
        return (events || []).slice(0, 50).map(e => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location: e.location,
          description: e.description,
          calendarId: e.calendarId,
        }));
      }
      case 'create_calendar_event': {
        if (!input.summary) return { error: 'summary is required' };
        const result = await api.google.createEvent('primary', {
          summary: input.summary,
          description: input.description,
          location: input.location,
          start: { dateTime: _ensureTzOffset(input.start_datetime) },
          end: { dateTime: _ensureTzOffset(input.end_datetime) },
        });
        _dispatch('bloom:calendar-changed', { type: 'created', id: result?.id, summary: input.summary });
        return {
          success: true,
          id: result?.id,
          htmlLink: result?.htmlLink,
          summary: result?.summary || input.summary,
          start: result?.start?.dateTime || input.start_datetime,
          end: result?.end?.dateTime || input.end_datetime,
        };
      }
      case 'update_calendar_event': {
        if (!input.event_id) return { error: 'event_id is required' };
        const updates = {};
        if (input.summary) updates.summary = input.summary;
        if (input.description != null) updates.description = input.description;
        if (input.location != null) updates.location = input.location;
        if (input.start_datetime) updates.start = { dateTime: _ensureTzOffset(input.start_datetime) };
        if (input.end_datetime) updates.end = { dateTime: _ensureTzOffset(input.end_datetime) };
        const result = await api.google.updateEvent('primary', input.event_id, updates);
        _dispatch('bloom:calendar-changed', { type: 'updated', id: input.event_id });
        return { success: true, id: result?.id || input.event_id };
      }
      case 'delete_calendar_event': {
        if (!input.event_id) return { error: 'event_id is required' };
        await api.google.deleteEvent('primary', input.event_id);
        _dispatch('bloom:calendar-changed', { type: 'deleted', id: input.event_id });
        return { success: true, id: input.event_id };
      }
      default: return null;
    }
  }

  async function _executeNotes(name, input) {
    const api = _api();
    switch (name) {
      case 'list_notes': {
        const notes = await api.notes.list();
        return (notes || []).slice(0, 100).map(n => ({
          id: n.id,
          title: n.title || n.name || '(untitled)',
          modifiedTime: n.modifiedTime,
        }));
      }
      case 'create_note': {
        if (!input.title) return { error: 'title is required' };
        // Mobile notes.create signature: (title, content, parentFolderId, parentNoteId)
        // Content is passed through as-is — the Notes service wraps Markdown in
        // the TipTap JSON envelope format.
        const result = await api.notes.create(input.title, input.content || '', null, null);
        _dispatch('bloom:notes-changed', { type: 'created', id: result?.id, title: input.title });
        return { success: true, id: result?.id, title: input.title };
      }
      case 'get_note': {
        if (!input.note_id) return { error: 'note_id is required' };
        const note = await api.notes.get(input.note_id);
        if (!note) return { error: 'note not found' };
        // Strip heavy fields from the returned blob — the model only
        // needs title + content. `doc`/`html` add a lot of tokens.
        return {
          id: note.id,
          title: note.title,
          content: note.markdown || note.content || note.text || '',
          modifiedTime: note.modifiedTime,
        };
      }
      case 'update_note': {
        if (!input.note_id) return { error: 'note_id is required' };
        const result = await api.notes.update(input.note_id, input.title, input.content);
        _dispatch('bloom:notes-changed', { type: 'updated', id: input.note_id, title: input.title });
        return { success: true, id: result?.id || input.note_id };
      }
      case 'delete_note': {
        if (!input.note_id) return { error: 'note_id is required' };
        await api.notes.delete(input.note_id, { cascadeChildren: true });
        _dispatch('bloom:notes-changed', { type: 'deleted', id: input.note_id });
        return { success: true, id: input.note_id };
      }
      default: return null;
    }
  }

  async function _executeStudy(name, input) {
    const api = _api();
    switch (name) {
      case 'create_flashcards_from_text': {
        const deckName = String(input.deck_name || '').slice(0, 120).trim() || 'Flashcards';
        const raw = Array.isArray(input.cards) ? input.cards : [];
        const filtered = raw
          .map(c => ({ front: String(c.front || '').trim(), back: String(c.back || '').trim() }))
          .filter(c => c.front || c.back);
        if (!filtered.length) return { error: 'No cards provided' };

        const deck = await api.study.createDeck({ name: deckName });
        if (!deck?.id) return { error: 'Failed to create deck' };

        // Add cards sequentially — addCard on mobile is async-file-backed
        // so a Promise.all would race the file write for the same deck.
        for (const c of filtered) {
          try { await api.study.addCard(deck.id, c); } catch { /* skip one bad card */ }
        }
        _dispatch('bloom:decks-changed', { type: 'created', deckId: deck.id });
        // Trigger a sync push so the new deck lands in Drive for the
        // user's other devices. If sync is disabled it's a no-op.
        try { api.study.syncNow?.(); } catch { /* ignore */ }
        return { deck_id: deck.id, deck_name: deck.name, card_count: filtered.length };
      }
      case 'add_flashcard_to_deck': {
        const deckId = String(input.deck_id || '');
        const front = String(input.front || '').trim();
        const back = String(input.back || '').trim();
        if (!deckId || !front) return { error: 'deck_id and front are required' };
        const card = await api.study.addCard(deckId, { front, back });
        if (!card || card.error) return { error: card?.error || 'deck not found' };
        _dispatch('bloom:decks-changed', { type: 'updated', deckId });
        try { api.study.syncNow?.(); } catch { /* ignore */ }
        return { card_id: card.id, deck_id: deckId };
      }
      case 'list_flashcard_decks': {
        const decks = await api.study.listDecks();
        return {
          decks: (decks || []).map(d => ({
            id: d.id,
            name: d.name,
            card_count: Array.isArray(d.cards) ? d.cards.length : d.cardCount || 0,
            due_count: (d.dueCount || 0) + (d.newCount || 0),
          }))
        };
      }
      case 'start_pomodoro': {
        const n = Number(input.duration_min);
        const duration = Number.isFinite(n) ? Math.max(1, Math.min(120, Math.round(n))) : null;
        // Fire a custom event that study.js listens to. If nobody's
        // listening (Study tab not mounted), navigate there first.
        try {
          if (window.Router?.navigate) window.Router.navigate('study');
        } catch { /* ignore */ }
        _dispatch('bloom:pomodoro-start', { durationMin: duration });
        return {
          started: true,
          duration_min: duration,
          note: duration
            ? `Focus session of ${duration} minutes starting now.`
            : 'Focus session starting with your configured default length.',
        };
      }
      default: return null;
    }
  }

  /**
   * Top-level tool router. Returns the executor's result (always a JSON-
   * serializable object). Errors are caught and returned as `{ error }`
   * so the model gets something useful back instead of the stream dying.
   */
  async function executeTool(name, input) {
    try {
      if (!_api()) return { error: 'Bridge not ready' };
      let result = await _executeCalendar(name, input || {});
      if (result !== null) return result;
      result = await _executeNotes(name, input || {});
      if (result !== null) return result;
      result = await _executeStudy(name, input || {});
      if (result !== null) return result;
      return { error: `Unknown tool: ${name}` };
    } catch (err) {
      console.warn(`[ai-tools] ${name} failed:`, err);
      return { error: String(err?.message || err || 'tool execution failed') };
    }
  }

  /** Claude tools array. */
  function getAllTools() {
    return TOOLS.slice();
  }

  /**
   * OpenAI (and OpenRouter) format: { type: 'function', function: { name, description, parameters } }.
   */
  function getAllToolsForOpenAI() {
    return TOOLS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      }
    }));
  }

  /**
   * Gemini `functionDeclarations` format — drop-in field names are close
   * to Claude's but Gemini is stricter about the schema. `_sanitizeForGemini`
   * strips unsupported fields (like top-level `additionalProperties` and
   * schema nodes that Gemini rejects). Enough to let basic tool use work.
   */
  function _sanitizeForGemini(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    const out = Array.isArray(schema) ? [] : {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'additionalProperties' || k === '$schema') continue;
      if (k === 'type' && typeof v === 'string') {
        // Gemini wants uppercase primitive types.
        out.type = v.toUpperCase();
      } else if (v && typeof v === 'object') {
        out[k] = _sanitizeForGemini(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  function getAllToolsForGemini() {
    return [{
      functionDeclarations: TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: _sanitizeForGemini(t.input_schema),
      })),
    }];
  }

  /** Friendly label for the chat "tool in progress" indicator. */
  const TOOL_LABELS = {
    get_upcoming_events: 'Checking your calendar',
    create_calendar_event: 'Creating event',
    update_calendar_event: 'Updating event',
    delete_calendar_event: 'Removing event',
    list_notes: 'Looking through your notes',
    create_note: 'Writing a new note',
    get_note: 'Reading your note',
    update_note: 'Updating your note',
    delete_note: 'Deleting a note',
    create_flashcards_from_text: 'Building your flashcard deck',
    add_flashcard_to_deck: 'Adding a flashcard',
    list_flashcard_decks: 'Checking your decks',
    start_pomodoro: 'Starting a focus session',
  };

  window._bloomAITools = {
    getAllTools,
    getAllToolsForOpenAI,
    getAllToolsForGemini,
    executeTool,
    TOOL_LABELS,
  };
})();
