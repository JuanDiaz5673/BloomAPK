// ─── Ambient Bloom Chat Panel ───
// Lives inside the sidebar. Click the Bloom trigger to expand the sidebar
// into a chat panel without leaving the current view (notes, files, calendar, etc).
//
// Shares conversation state with the main Chat view via `window._activeConversationId`
// — what you say here appears there and vice versa. This single shared ID is the
// canonical "active conversation" for the session.
const BloomPanel = (() => {
  let isOpen = false;
  let sidebar = null;
  let trigger = null;
  let panel = null;
  let messagesEl = null;
  let input = null;
  let sendBtn = null;
  let closeBtn = null;
  let currentAssistantBubble = null;
  let currentAssistantText = '';

  // Hover-to-open state:
  //   - OPEN_DELAY prevents accidental opens when the cursor grazes the avatar
  //   - CLOSE_DELAY gives the user a grace window to move across the sidebar
  //     without losing the panel
  //   - suppressHoverUntilLeave: set when user explicitly closes (X / Esc) so
  //     the panel doesn't immediately re-open from lingering hover. Cleared
  //     when the mouse actually leaves the sidebar.
  const HOVER_OPEN_DELAY = 150;
  const HOVER_CLOSE_DELAY = 400;
  let openTimer = null;
  let closeTimer = null;
  let suppressHoverUntilLeave = false;
  // Local message history for the active conversation (pulled from disk on first open
  // OR built up as user chats). The main Chat view has its own; they converge via the
  // shared conversation ID + disk persistence.
  let messages = [];
  let cleanupStreamListeners = null;
  let hasLoadedConversation = false;

  function init() {
    sidebar = document.querySelector('.sidebar');
    trigger = document.getElementById('sidebar-bloom-trigger');
    panel = document.getElementById('sidebar-bloom-panel');
    messagesEl = document.getElementById('sidebar-bloom-messages');
    input = document.getElementById('sidebar-bloom-input');
    sendBtn = document.getElementById('sidebar-bloom-send');
    closeBtn = document.getElementById('sidebar-bloom-close');

    if (!sidebar || !trigger || !panel) return; // guard for any rendering edge case

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      // Clicking the trigger clears any pending hover timers and toggles explicitly.
      // Clicking to close also activates the "suppress" flag so hover can't re-open it
      // until the user's mouse has actually left the sidebar and come back.
      _clearTimers();
      if (isOpen) suppressHoverUntilLeave = true;
      toggle();
    });
    closeBtn?.addEventListener('click', () => {
      suppressHoverUntilLeave = true;
      close();
    });
    sendBtn?.addEventListener('click', sendMessage);

    // ── Hover-to-open / hover-away-to-close ──
    trigger.addEventListener('mouseenter', _scheduleHoverOpen);
    trigger.addEventListener('mouseleave', () => {
      // If the user moved off the trigger before the open-delay fired, cancel
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    });
    sidebar.addEventListener('mouseleave', () => {
      // Leaving the sidebar clears the suppress flag (user committed to moving away)
      // and schedules a close if the panel is open
      suppressHoverUntilLeave = false;
      if (isOpen) _scheduleHoverClose();
    });
    sidebar.addEventListener('mouseenter', () => {
      // Re-entering cancels any pending close
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    });

    // Enter to send, Shift+Enter for newline, Esc to close
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    // Auto-grow the textarea up to max-height — rAF-gated to avoid
    // forcing a sync layout on every keystroke (scrollHeight read
    // immediately followed by a height write).
    let _inputResizePending = false;
    input?.addEventListener('input', () => {
      if (_inputResizePending) return;
      _inputResizePending = true;
      requestAnimationFrame(() => {
        _inputResizePending = false;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });
    });

    // Esc closes even if focus is elsewhere in the panel
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function _clearTimers() {
    if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  }

  function _scheduleHoverOpen() {
    if (isOpen || suppressHoverUntilLeave) return;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (openTimer) return;
    openTimer = setTimeout(() => {
      openTimer = null;
      if (!isOpen && !suppressHoverUntilLeave) open();
    }, HOVER_OPEN_DELAY);
  }

  function _scheduleHoverClose() {
    if (!isOpen) return;
    if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    if (closeTimer) return;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!isOpen) return;
      // Never auto-close if the user has a typed draft or an AI response is mid-stream —
      // that would lose their work / cut off Bloom mid-sentence. Stay open; user can
      // click the X or Esc when they're actually done.
      const hasDraft = input && input.value.trim().length > 0;
      const isStreaming = currentAssistantBubble != null;
      if (hasDraft || isStreaming) return;
      close();
    }, HOVER_CLOSE_DELAY);
  }

  async function open() {
    if (isOpen || !sidebar) return;
    isOpen = true;
    sidebar.classList.add('chat-open');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-label', 'Close Bloom chat');

    // Wire stream listeners (only while panel is open, to avoid duplicate event handling)
    _attachStreamListeners();

    // Sync messages from whichever conversation is the current active one
    await _loadActiveConversation();

    // Notify calendar (and anyone else) so they can smoothly resize alongside the expansion
    document.dispatchEvent(new CustomEvent('sidebar-width-change', { detail: { state: 'chat-open' } }));

    // Focus input after the animation has started so the user can type immediately
    setTimeout(() => input?.focus(), 200);
  }

  function close() {
    if (!isOpen || !sidebar) return;
    isOpen = false;
    sidebar.classList.remove('chat-open');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Open Bloom chat');

    // Detach stream listeners so we don't double-process events while closed
    _detachStreamListeners();

    // Blur the input so keyboard shortcuts (like Ctrl+K for search) work elsewhere
    if (document.activeElement === input) input.blur();

    document.dispatchEvent(new CustomEvent('sidebar-width-change', { detail: { state: 'closed' } }));
  }

  /** Pull the most recent messages from the active conversation (if any) and render them.
   *  Always fetches fresh from disk — cheap, and ensures the panel picks up messages
   *  added from any other chat surface (home view, main Chat view) since last open. */
  async function _loadActiveConversation() {
    if (!window.electronAPI) return;
    const activeId = window._activeConversationId;

    if (!activeId) {
      messages = [];
      _renderEmptyState();
      hasLoadedConversation = false;
      return;
    }

    try {
      const conv = await window.electronAPI.ai.getConversation(activeId);
      if (!conv || !conv.messages) {
        messages = [];
        _renderEmptyState();
        return;
      }
      messages = conv.messages;
      _renderMessageHistory(messages);
      hasLoadedConversation = true;
    } catch (err) {
      console.warn('Could not load active conversation into ambient panel:', err);
    }
  }

  function _renderEmptyState() {
    if (!messagesEl) return;
    messagesEl.innerHTML = `<div class="sidebar-bloom-empty">
      Ask me anything — I can create events, jot notes, summarize your day…
    </div>`;
  }

  /** Render full message history in the panel. Mirrors main Chat view's format. */
  function _renderMessageHistory(msgs) {
    if (!messagesEl) return;
    messagesEl.innerHTML = '';
    for (const msg of msgs) {
      if (typeof msg.content === 'string') {
        _appendBubble(msg.role === 'assistant' ? 'assistant' : 'user', msg.content);
      } else if (Array.isArray(msg.content)) {
        // Tool-use/tool-result blocks from streamChat internal format — only show text parts
        const textParts = msg.content.filter(b => b.type === 'text' || typeof b.text === 'string');
        if (textParts.length > 0) {
          const text = textParts.map(b => b.text || '').join('');
          if (text.trim()) _appendBubble(msg.role === 'assistant' ? 'assistant' : 'user', text);
        }
      }
    }
    _scrollToBottom();
  }

  function _appendBubble(role, text) {
    if (!messagesEl) return null;
    // Remove empty state if present
    const empty = messagesEl.querySelector('.sidebar-bloom-empty');
    if (empty) empty.remove();

    const wrap = document.createElement('div');
    wrap.className = `sb-msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'sb-msg-bubble';
    if (role === 'assistant') bubble.innerHTML = _simpleMarkdown(text);
    else bubble.textContent = text;
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    _scrollToBottom();
    return bubble;
  }

  function _showTyping() {
    if (!messagesEl) return;
    const existing = messagesEl.querySelector('.sb-typing');
    if (existing) return;
    const t = document.createElement('div');
    t.className = 'sb-typing';
    t.id = 'sb-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(t);
    _scrollToBottom();
  }

  function _removeTyping() {
    messagesEl?.querySelector('.sb-typing')?.remove();
  }

  function _scrollToBottom() {
    if (!messagesEl) return;
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // Markdown renderer mirroring chat.js's simpleMarkdown — handles
  // bold/italic/strike, inline code, fenced code blocks, headings,
  // lists, links, blockquotes. Safe for live streaming (every pattern
  // is non-greedy so an unclosed `**` mid-stream renders as literal).
  // TODO: consolidate with chat.js's copy into a shared
  // src/renderer/js/components/markdown.js so future fixes happen in
  // one place. Two copies of the same parser is asking for drift bugs.
  function _simpleMarkdown(text) {
    if (!text) return '';
    const codeBlocks = [];
    let working = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, body) => {
      codeBlocks.push({ lang: lang || '', body });
      return `\u0000CB${codeBlocks.length - 1}\u0000`;
    });
    working = _escape(working);
    const lines = working.split('\n');
    const out = [];
    let inList = null;
    const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
    for (const raw of lines) {
      const headMatch = raw.match(/^(#{1,3})\s+(.+)$/);
      if (headMatch) { closeList(); out.push(`<h${headMatch[1].length + 2}>${headMatch[2]}</h${headMatch[1].length + 2}>`); continue; }
      if (/^>\s+/.test(raw)) { closeList(); out.push(`<blockquote>${raw.replace(/^>\s+/, '')}</blockquote>`); continue; }
      const ulMatch = raw.match(/^(\s*)[-*+]\s+(.+)$/);
      if (ulMatch) { if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; } out.push(`<li>${ulMatch[2]}</li>`); continue; }
      const olMatch = raw.match(/^(\s*)\d+\.\s+(.+)$/);
      if (olMatch) { if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; } out.push(`<li>${olMatch[2]}</li>`); continue; }
      if (raw.trim() === '') { closeList(); out.push(''); continue; }
      closeList(); out.push(raw);
    }
    closeList();
    working = out.join('\n')
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
      .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) =>
        `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
      .replace(/\n/g, '<br>')
      .replace(/(<br>\s*){3,}/g, '<br><br>');
    return working.replace(/\u0000CB(\d+)\u0000/g, (_, idx) => {
      const { lang, body } = codeBlocks[Number(idx)];
      const langClass = lang ? ` class="lang-${_escape(lang)}"` : '';
      return `<pre class="chat-code-block"><code${langClass}>${_escape(body)}</code></pre>`;
    });
  }

  // Friendly labels for tool-use indicator. Mirrors chat.js's TOOL_LABELS
  // (TODO: consolidate). Add new tools here when wired.
  const _TOOL_LABELS = {
    get_upcoming_events: 'Checking your calendar',
    create_calendar_event: 'Creating event',
    update_calendar_event: 'Updating event',
    delete_calendar_event: 'Deleting event',
    list_notes: 'Looking through your notes',
    create_note: 'Writing a new note',
    get_note: 'Reading your note',
    update_note: 'Updating your note',
    delete_note: 'Deleting note',
    get_dashboard_summary: 'Checking your dashboard',
    create_flashcards_from_text: 'Building your flashcard deck',
    add_flashcard_to_deck: 'Adding a card to your deck',
    list_flashcard_decks: 'Looking up your decks',
    start_pomodoro: 'Starting focus session',
    web_search: 'Searching the web',
  };

  // Full HTML+attribute escape. textContent → innerHTML alone doesn't escape
  // `"` or `'`, which is fine for text-position interpolation but unsafe if
  // any caller ever puts the result in an attribute value. This belt-and-
  // suspenders implementation is safe in both contexts.
  function _escape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function sendMessage() {
    if (!input || !window.electronAPI) return;
    const text = input.value.trim();
    if (!text) return;

    // Check AI is configured
    const hasAny = await window.electronAPI.ai.hasAnyProvider();
    if (!hasAny) {
      _appendBubble('assistant', 'Set up an AI provider in Settings first — I need either a Claude or Gemini key to help.');
      return;
    }

    // Append user bubble + clear input
    _appendBubble('user', text);
    messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';

    // Establish conversation ID if none yet (shared across sidebar + main chat view)
    if (!window._activeConversationId) {
      window._activeConversationId = `conv_${Date.now()}`;
    }

    _showTyping();
    currentAssistantBubble = null;
    currentAssistantText = '';

    try {
      const result = await window.electronAPI.ai.streamChat(messages, window._activeConversationId);
      if (result && result.success === false && result.error !== 'Aborted') {
        _removeTyping();
        _appendBubble('assistant', result.error || 'Something went wrong. Try again?');
      }
    } catch (err) {
      _removeTyping();
      _appendBubble('assistant', 'Something went wrong. Try again?');
      console.error('Ambient chat error:', err);
    }
  }

  // ── Stream event handlers ──
  function _handleStreamDelta(data) {
    if (!isOpen) return;
    if (data.conversationId !== window._activeConversationId) return;

    _removeTyping();
    // Real text supersedes any "Searching..." / "Reading note..." indicator.
    messagesEl?.querySelectorAll('.sb-tool-indicator').forEach(el => el.remove());
    if (!currentAssistantBubble) {
      currentAssistantBubble = _appendBubble('assistant', '');
      currentAssistantText = '';
    }
    currentAssistantText += data.text;
    // Coalesce markdown repaint to one per animation frame (see chat.js
    // — same reasoning: avoid O(n²) re-parse + full innerHTML swap per
    // delta when the display can only show one frame per ~16ms).
    _scheduleBubbleRepaint(currentAssistantBubble);
  }

  let _bubbleRepaintScheduled = false;
  function _scheduleBubbleRepaint(bubble) {
    if (_bubbleRepaintScheduled) return;
    _bubbleRepaintScheduled = true;
    requestAnimationFrame(() => {
      _bubbleRepaintScheduled = false;
      if (!currentAssistantBubble || !bubble.isConnected) return;
      bubble.innerHTML = _simpleMarkdown(currentAssistantText);
      _scrollToBottom();
    });
  }

  function _handleStreamDone(data) {
    if (!isOpen) return;
    if (data.conversationId !== window._activeConversationId) return;

    _removeTyping();
    messagesEl?.querySelectorAll('.sb-tool-indicator').forEach(el => el.remove());
    if (currentAssistantBubble && currentAssistantText) {
      currentAssistantBubble.innerHTML = _simpleMarkdown(currentAssistantText);
      messages.push({ role: 'assistant', content: currentAssistantText });
    }
    currentAssistantBubble = null;
    currentAssistantText = '';
    hasLoadedConversation = true; // our local `messages` is now up to date
  }

  function _handleStreamError(data) {
    if (!isOpen) return;
    if (data.conversationId && data.conversationId !== window._activeConversationId) return;

    _removeTyping();
    messagesEl?.querySelectorAll('.sb-tool-indicator').forEach(el => el.remove());
    if (currentAssistantBubble && currentAssistantText) {
      currentAssistantBubble.innerHTML = _simpleMarkdown(currentAssistantText) +
        `<br><em style="color:#ff9a9a;opacity:0.8;">${_escape(data.error || 'error')}</em>`;
    } else {
      _appendBubble('assistant', `Sorry, ${data.error || 'something went wrong.'}`);
    }
    currentAssistantBubble = null;
    currentAssistantText = '';
  }

  function _handleToolUse(data) {
    if (!isOpen) return;
    if (data.conversationId !== window._activeConversationId) return;
    _removeTyping();
    // Replace any existing indicator — only the most recent action is
    // interesting (Bloom may chain list_notes → get_note → create_…).
    messagesEl?.querySelectorAll('.sb-tool-indicator').forEach(el => el.remove());

    const label = _TOOL_LABELS[data.toolName] || 'Working';
    const isServer = !!data.isServerTool;
    const ind = document.createElement('div');
    ind.className = 'sb-msg assistant sb-tool-indicator' + (isServer ? ' is-server-tool' : '');
    // Pulsing dots + label + breathing ellipsis. Same visual language
    // as the main chat view's indicator so the two surfaces feel
    // unified — no jarring style switch when you move from sidebar to
    // full chat. The "is-server-tool" class punches the styling up for
    // longer-running web searches.
    ind.innerHTML = `<div class="sb-msg-bubble sb-tool-bubble">
      <span class="sb-tool-pulse"><span></span><span></span><span></span></span>
      <span class="sb-tool-label">${_escape(label)}<span class="sb-tool-ellipsis">…</span></span>
    </div>`;
    messagesEl?.appendChild(ind);
    _scrollToBottom();
    // No auto-remove — indicator stays until next text delta arrives,
    // a new tool fires (replacement above), or the stream ends/errors
    // (handled in _handleStreamDelta / _handleStreamDone / _handleStreamError).
  }

  function _attachStreamListeners() {
    if (cleanupStreamListeners) return;
    if (!window.electronAPI?.ai) return;
    const removeDelta = window.electronAPI.ai.onStreamDelta(_handleStreamDelta);
    const removeDone  = window.electronAPI.ai.onStreamDone(_handleStreamDone);
    const removeErr   = window.electronAPI.ai.onStreamError(_handleStreamError);
    const removeTool  = window.electronAPI.ai.onToolUse(_handleToolUse);
    cleanupStreamListeners = () => {
      try { removeDelta(); } catch {}
      try { removeDone(); } catch {}
      try { removeErr(); } catch {}
      try { removeTool(); } catch {}
    };
  }

  function _detachStreamListeners() {
    if (cleanupStreamListeners) {
      cleanupStreamListeners();
      cleanupStreamListeners = null;
    }
  }

  /** External callers can invalidate the cached messages (e.g. when user switches
   *  conversations in the main Chat view, they call this so next panel-open re-fetches). */
  function invalidateCache() {
    hasLoadedConversation = false;
  }

  return { init, open, close, toggle, invalidateCache };
})();
