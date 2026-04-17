// ─── Chat View (Bloom AI) ───
const ChatView = (() => {
  let messages = [];
  let cleanupFns = [];

  // currentConversationId is mirrored to window._activeConversationId so the
  // ambient sidebar panel (BloomPanel) and this view share the same conversation.
  // See CLAUDE.md "Ambient Bloom panel" section. Use the getter/setter below
  // instead of assigning directly — keeps them in sync.
  const _getConvId = () => window._activeConversationId || null;
  const _setConvId = (id) => {
    window._activeConversationId = id;
    if (typeof BloomPanel !== 'undefined') BloomPanel.invalidateCache();
  };

  function _renderWelcome() {
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px;">
      <div style="position:relative;">
        <img src="assets/images/bloom-avatar.png" style="width:100px;height:100px;border-radius:50%;animation:float 4s ease-in-out infinite;filter:drop-shadow(0 8px 24px rgba(255,107,157,0.35));" alt="Bloom">
        <div style="position:absolute;bottom:4px;right:4px;width:14px;height:14px;border-radius:50%;background:#6fdb8b;border:3px solid rgba(30,12,20,0.8);box-shadow:0 0 10px rgba(111,219,139,0.5);"></div>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:400;background:linear-gradient(135deg,#fff 20%,var(--accent-blush));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">Bloom Assistant</div>
      <div style="font-size:13px;color:var(--text-muted);font-weight:300;text-align:center;max-width:340px;line-height:1.7;">Ask me anything, schedule events, take notes, or just chat. I can help manage your dashboard too.</div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
        <div class="chat-suggestion-chip">&ldquo;What&rsquo;s on my calendar?&rdquo;</div>
        <div class="chat-suggestion-chip">&ldquo;Create a note&rdquo;</div>
        <div class="chat-suggestion-chip">&ldquo;Schedule a meeting&rdquo;</div>
      </div>
    </div>`;
  }

  function render() {
    return `
    <div class="chat-view">
      <div class="glass-card chat-sidebar" style="border-radius:16px;animation:fadeSlideUp 0.5s ease 0.05s both;">
        <div class="chat-sidebar-header">
          <h3 style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:400;">Conversations</h3>
          <button class="new-chat-btn" id="new-chat-btn" title="New chat">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <div class="chat-history" id="chat-history"></div>
      </div>
      <div class="glass-card chat-main" style="border-radius:16px;padding:0;overflow:hidden;animation:fadeSlideUp 0.5s ease 0.1s both;">
        <div class="chat-messages" id="chat-messages">
          ${_renderWelcome()}
        </div>
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <textarea id="chat-textarea" rows="1" placeholder="Message Bloom..." data-i18n-placeholder="chat_placeholder"></textarea>
            <button class="chat-send-btn" id="chat-send-btn">
              <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }

  async function init() {
    const textarea = document.getElementById('chat-textarea');
    const sendBtn = document.getElementById('chat-send-btn');
    const messagesEl = document.getElementById('chat-messages');

    // Auto-resize textarea — rAF-gated so the read/write pair (scrollHeight
    // read, then height write) happens inside a single layout frame instead
    // of forcing a sync reflow on every keystroke. Coalesces rapid bursts
    // of `input` events (IME, paste) to one measurement.
    let _taResizePending = false;
    textarea?.addEventListener('input', () => {
      if (_taResizePending) return;
      _taResizePending = true;
      requestAnimationFrame(() => {
        _taResizePending = false;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      });
    });

    // Send on Enter (Shift+Enter for newline)
    textarea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn?.addEventListener('click', sendMessage);
    document.getElementById('new-chat-btn')?.addEventListener('click', startNewChat);

    // Set up stream listeners
    if (window.electronAPI) {
      const removeDelta = window.electronAPI.ai.onStreamDelta(handleStreamDelta);
      const removeDone = window.electronAPI.ai.onStreamDone(handleStreamDone);
      const removeToolUse = window.electronAPI.ai.onToolUse(handleToolUse);
      const removeError = window.electronAPI.ai.onStreamError(handleStreamError);
      cleanupFns.push(removeDelta, removeDone, removeToolUse, removeError);
    }

    // Load conversation history
    await loadConversationList();

    // Deep link: open a specific conversation if requested (from search, etc)
    const link = typeof Router !== 'undefined' ? Router.consumeDeepLink('conversation') : null;
    if (link?.id) {
      try { await loadConversation(link.id); } catch (err) { console.warn('Deep-link to conversation failed:', err); }
    } else if (_getConvId()) {
      // If the user was already chatting via the ambient sidebar panel and just
      // navigated to the Chat view, load that same active conversation so they
      // see continuous history.
      try { await loadConversation(_getConvId()); } catch {}
    }
  }

  async function loadConversationList() {
    if (!window.electronAPI) return;
    try {
      const conversations = await window.electronAPI.ai.listConversations();
      const historyEl = document.getElementById('chat-history');
      if (!historyEl) return;

      if (!conversations || conversations.length === 0) {
        historyEl.innerHTML = `<div style="padding:14px 10px;font-size:11px;color:var(--text-muted);font-weight:300;font-style:italic;text-align:center;">No conversations yet</div>`;
        return;
      }

      historyEl.innerHTML = conversations.map(c => `
        <div class="chat-history-item ${c.id === _getConvId() ? 'active' : ''}" data-conv-id="${c.id}" title="${_escapeAttr(c.title)}">
          <span class="chat-history-title">${_escapeHtml(c.title)}</span>
          <button class="chat-history-delete" data-del-id="${c.id}" data-del-title="${_escapeAttr(c.title)}" aria-label="Delete conversation" title="Delete">
            <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `).join('');

      historyEl.querySelectorAll('.chat-history-item').forEach(item => {
        item.addEventListener('click', (e) => {
          // Ignore clicks on the delete button — those have their own handler
          if (e.target.closest('.chat-history-delete')) return;
          loadConversation(item.dataset.convId);
        });
      });

      historyEl.querySelectorAll('.chat-history-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.delId;
          const title = btn.dataset.delTitle;
          const confirmed = await Confirm.show(
            `Delete "${title}"? This can't be undone.`,
            'Delete conversation'
          );
          if (!confirmed) return;

          try {
            await window.electronAPI.ai.deleteConversation(id);
            // If the deleted one was active, clear the view and shared ID
            if (id === _getConvId()) {
              _setConvId(null);
              messages = [];
              const messagesEl = document.getElementById('chat-messages');
              if (messagesEl) messagesEl.innerHTML = _renderWelcome();
            }
            await loadConversationList();
            Toast.show('Conversation deleted', 'success');
          } catch (err) {
            Toast.show('Failed to delete conversation', 'error');
            console.error('Delete conversation failed:', err);
          }
        });
      });
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  // Canonical 5-char escape — handles &, <, >, ", '. Safe in BOTH text-
  // position interpolation AND attribute values (single- or double-quoted).
  // Use this anywhere external content (Drive titles, AI text, calendar
  // event summaries) flows into a template literal. The previous textContent
  // → innerHTML round-trip + extra " replace was fragile: if a future
  // refactor switched to single-quoted attributes, XSS would silently open.
  function _escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // Kept as an alias so existing callers don't have to change. Both
  // contexts use the same escape so quote choice in attributes is safe.
  const _escapeAttr = _escapeHtml;

  async function loadConversation(id) {
    if (!window.electronAPI) return;
    try {
      const conv = await window.electronAPI.claude.getConversation(id);
      if (!conv) return;

      _setConvId(id);
      messages = conv.messages.filter(m => typeof m.content === 'string');

      const messagesEl = document.getElementById('chat-messages');
      if (!messagesEl) return;

      messagesEl.innerHTML = '';
      messages.forEach(m => {
        appendMessageBubble(m.role, m.content);
      });

      await loadConversationList();
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }

  function startNewChat() {
    _setConvId(`conv_${Date.now()}`);
    messages = [];
    const messagesEl = document.getElementById('chat-messages');
    if (messagesEl) {
      messagesEl.innerHTML = _renderWelcome();
    }
    loadConversationList();
  }

  let currentAssistantBubble = null;
  // Buffer of the in-flight assistant response. We re-render the WHOLE
  // buffer through simpleMarkdown on every delta so the user sees
  // **bold** become bold AS Bloom types it, not 10 seconds later when
  // streaming completes. (Previous behavior: appended raw textContent
  // during stream, then swapped to markdown at done — making it look
  // like markdown wasn't supported during the entire visible response.)
  let currentAssistantBuffer = '';

  async function sendMessage() {
    const textarea = document.getElementById('chat-textarea');
    const text = textarea?.value.trim();
    if (!text) return;

    textarea.value = '';
    textarea.style.height = 'auto';

    // Clear welcome screen on first message
    const messagesEl = document.getElementById('chat-messages');
    if (messages.length === 0 && messagesEl) {
      messagesEl.innerHTML = '';
    }

    // Add user message
    messages.push({ role: 'user', content: text });
    appendMessageBubble('user', text);

    if (!_getConvId()) {
      _setConvId(`conv_${Date.now()}`);
    }

    // Show typing indicator
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl?.appendChild(typing);
    scrollToBottom();

    // Send to Claude
    if (window.electronAPI) {
      try {
        const hasAny = await window.electronAPI.ai.hasAnyProvider();
        if (!hasAny) {
          typing.remove();
          appendMessageBubble('assistant', 'Please set up an AI provider in Settings to chat with me! You can use Claude (paid) or Gemini (free).');
          return;
        }
        currentAssistantBubble = null;
        // streamChat resolves with { success, error } — if the IPC call itself
        // throws or returns failure, surface it to the user. Stream errors
        // also flow via the onStreamError listener which removes the typing
        // indicator separately, so we de-dupe by checking it's still present.
        const result = await window.electronAPI.ai.streamChat(messages, _getConvId());
        if (result && result.success === false && result.error !== 'Aborted') {
          if (document.getElementById('typing-indicator')) {
            typing.remove();
            appendMessageBubble('assistant', result.error || 'Sorry, something went wrong. Please try again.');
          }
        }
      } catch (err) {
        if (document.getElementById('typing-indicator')) {
          typing.remove();
          appendMessageBubble('assistant', 'Sorry, something went wrong. Please try again.');
        }
        console.error('Chat stream error:', err);
      }
    } else {
      // Not in Electron - show demo response
      typing.remove();
      appendMessageBubble('assistant', "I'm Bloom! To use me fully, run AllDash as a desktop app with your Claude API key configured in Settings.");
    }
  }

  function handleStreamDelta(data) {
    if (data.conversationId !== _getConvId()) return;

    document.getElementById('typing-indicator')?.remove();
    // First text chunk arrived → tear down any "Searching..." / "Working..."
    // tool indicator that was up. Real text supersedes the placeholder.
    document.querySelectorAll('.chat-tool-indicator').forEach(el => el.remove());

    const messagesEl = document.getElementById('chat-messages');
    if (!currentAssistantBubble) {
      currentAssistantBubble = document.createElement('div');
      currentAssistantBubble.className = 'chat-message assistant';
      currentAssistantBubble.innerHTML = `
        <div class="chat-message-avatar">B</div>
        <div class="chat-message-content"></div>`;
      messagesEl?.appendChild(currentAssistantBubble);
      currentAssistantBuffer = '';
    }

    const content = currentAssistantBubble.querySelector('.chat-message-content');
    if (content) {
      currentAssistantBuffer += data.text;
      // Coalesce markdown repaint to one per animation frame. Previous
      // behavior re-parsed the entire buffer + swapped innerHTML on every
      // delta (O(n²) over stream length, repeated full-bubble reflows).
      // rAF drops intermediate frames when deltas arrive faster than the
      // display refresh — visually identical, far cheaper.
      _scheduleAssistantRepaint(content);
    }
  }

  let _repaintScheduled = false;
  function _scheduleAssistantRepaint(contentEl) {
    if (_repaintScheduled) return;
    _repaintScheduled = true;
    requestAnimationFrame(() => {
      _repaintScheduled = false;
      // Bubble may have been cleared (new chat, stream done, error) —
      // verify it's still the live target before writing.
      if (!currentAssistantBubble || !contentEl.isConnected) return;
      contentEl.innerHTML = simpleMarkdown(currentAssistantBuffer);
      scrollToBottom();
    });
  }

  function handleStreamDone(data) {
    if (data.conversationId !== _getConvId()) return;
    document.getElementById('typing-indicator')?.remove();
    document.querySelectorAll('.chat-tool-indicator').forEach(el => el.remove());

    if (currentAssistantBubble && currentAssistantBuffer) {
      // Final render — buffer's already been rendered as markdown via
      // each delta, but call once more to clean up any patterns that
      // only resolve once the whole message is in.
      messages.push({ role: 'assistant', content: currentAssistantBuffer });
      const content = currentAssistantBubble.querySelector('.chat-message-content');
      if (content) content.innerHTML = simpleMarkdown(currentAssistantBuffer);
    }

    currentAssistantBubble = null;
    currentAssistantBuffer = '';
    // Only rebuild the conversation sidebar when the list's CONTENTS
    // could have actually changed — i.e. this was the first turn of a
    // brand-new conversation (new row) or a title was generated. For
    // ongoing turns the list's visible fields (title + count) don't
    // change, so the previous unconditional full-list innerHTML swap
    // was a no-op that trashed row highlights and caused a reflow per
    // message. `data.isFirstTurn` is set by the main-process stream
    // done event when applicable; fall back to presence of `.active`
    // row to detect missing rows.
    const historyEl = document.getElementById('chat-history');
    const hasRowForActive = !!historyEl?.querySelector(`[data-conv-id="${_getConvId()}"]`);
    if (data?.isFirstTurn || !hasRowForActive) {
      loadConversationList();
    }
  }

  // Friendly action labels, keyed by the tool name Bloom is invoking.
  // Server tools (web_search) get an 'isServerTool' hint from the main
  // process and use a different style — we want "Searching the web..."
  // to feel distinctly more momentous than a local tool call. Add new
  // tools here as they're wired up.
  const TOOL_LABELS = {
    // Calendar
    get_upcoming_events: 'Checking your calendar',
    create_calendar_event: 'Creating event',
    update_calendar_event: 'Updating event',
    delete_calendar_event: 'Deleting event',
    // Notes
    list_notes: 'Looking through your notes',
    create_note: 'Writing a new note',
    get_note: 'Reading your note',
    update_note: 'Updating your note',
    delete_note: 'Deleting note',
    // Dashboard
    get_dashboard_summary: 'Checking your dashboard',
    // Study
    create_flashcards_from_text: 'Building your flashcard deck',
    add_flashcard_to_deck: 'Adding a card to your deck',
    list_flashcard_decks: 'Looking up your decks',
    start_pomodoro: 'Starting focus session',
    // Server tools (Anthropic-hosted)
    web_search: 'Searching the web',
  };

  function handleToolUse(data) {
    if (data.conversationId !== _getConvId()) return;
    document.getElementById('typing-indicator')?.remove();

    // Replace any previous indicator — only the most recent action is
    // interesting. (Bloom may chain tools — list_notes → get_note →
    // create_flashcards_from_text — and each fires its own tool-use
    // event. Showing the latest keeps the UI honest about what's
    // happening RIGHT NOW.)
    document.querySelectorAll('.chat-tool-indicator').forEach(el => el.remove());

    const messagesEl = document.getElementById('chat-messages');
    const indicator = document.createElement('div');
    indicator.className = 'chat-tool-indicator';
    if (data.isServerTool) indicator.classList.add('is-server-tool');

    const label = TOOL_LABELS[data.toolName] || 'Working';
    // Three pulsing dots after the label give a clear "in progress"
    // affordance — like the typing indicator but inline with the label.
    indicator.innerHTML = `
      <span class="tool-pulse" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
      <span class="tool-label">${escapeHtml(label)}<span class="tool-ellipsis">…</span></span>`;
    messagesEl?.appendChild(indicator);
    scrollToBottom();

    // No auto-remove timer. The indicator is removed on the next
    // text delta (handleStreamDelta), on a NEW tool-use event (above),
    // or on stream done/error. This way a 15-second web_search keeps
    // its indicator visible the whole time instead of vanishing at 5s.
  }

  function handleStreamError(data) {
    document.getElementById('typing-indicator')?.remove();
    document.querySelectorAll('.chat-tool-indicator').forEach(el => el.remove());
    if (currentAssistantBubble) {
      currentAssistantBuffer += '\n\n[Error: ' + data.error + ']';
      const content = currentAssistantBubble.querySelector('.chat-message-content');
      if (content) content.innerHTML = simpleMarkdown(currentAssistantBuffer);
    } else {
      appendMessageBubble('assistant', 'Sorry, an error occurred: ' + data.error);
    }
    currentAssistantBubble = null;
    currentAssistantBuffer = '';
  }

  function appendMessageBubble(role, text) {
    const messagesEl = document.getElementById('chat-messages');
    if (!messagesEl) return;

    const msg = document.createElement('div');
    msg.className = `chat-message ${role}`;
    msg.innerHTML = `
      <div class="chat-message-avatar">${role === 'assistant' ? 'B' : 'Y'}</div>
      <div class="chat-message-content">${role === 'assistant' ? simpleMarkdown(text) : escapeHtml(text)}</div>`;
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function scrollToBottom() {
    const messagesEl = document.getElementById('chat-messages');
    if (messagesEl) {
      requestAnimationFrame(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }
  }

  // Lightweight markdown renderer for chat. Handles the subset Bloom
  // actually emits: bold/italic/strike/inline-code, fenced code blocks,
  // headings (## / ###), bulleted + numbered lists, links, blockquotes.
  //
  // Designed to be safe for LIVE streaming: every transformation uses
  // non-greedy patterns so an unclosed `**` (still mid-stream) renders
  // as literal text rather than swallowing the rest of the buffer.
  // Every text segment is HTML-escaped BEFORE markdown transforms run,
  // so AI-generated content can't inject script tags.
  function simpleMarkdown(text) {
    if (!text) return '';

    // 1. Pull fenced code blocks out FIRST so other patterns don't
    //    chew on their contents (e.g. ** inside a code block stays
    //    literal). Replace each with a placeholder, restore at the end.
    const codeBlocks = [];
    let working = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, body) => {
      codeBlocks.push({ lang: lang || '', body });
      return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
    });

    // 2. Escape HTML on the remaining text. This must come before any
    //    HTML-emitting transforms — otherwise we'd escape our own tags.
    working = escapeHtml(working);

    // 3. Process line-level blocks before inline transforms so list
    //    items / headings / quotes don't pick up unwanted <em> from a
    //    leading "*" (which means bullet, not italic at line start).
    const lines = working.split('\n');
    const out = [];
    let inList = null; // 'ul' | 'ol' | null
    const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };

    for (let raw of lines) {
      // Headings ###, ##, # — only at start of line.
      const headMatch = raw.match(/^(#{1,3})\s+(.+)$/);
      if (headMatch) {
        closeList();
        const level = headMatch[1].length + 2; // # → h3, ## → h4, ### → h5 (chat is small)
        out.push(`<h${level}>${headMatch[2]}</h${level}>`);
        continue;
      }
      // Blockquote
      if (/^>\s+/.test(raw)) {
        closeList();
        out.push(`<blockquote>${raw.replace(/^>\s+/, '')}</blockquote>`);
        continue;
      }
      // Bullet list (-, *, +) — capture indent so nested items keep
      // working. We don't render true nesting; we just preserve indent
      // visually with a non-breaking-space pad.
      const ulMatch = raw.match(/^(\s*)[-*+]\s+(.+)$/);
      if (ulMatch) {
        if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
        const indent = ulMatch[1].length;
        const pad = indent > 0 ? '&nbsp;'.repeat(indent) : '';
        out.push(`<li>${pad}${ulMatch[2]}</li>`);
        continue;
      }
      // Numbered list — same treatment.
      const olMatch = raw.match(/^(\s*)\d+\.\s+(.+)$/);
      if (olMatch) {
        if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
        out.push(`<li>${olMatch[2]}</li>`);
        continue;
      }
      // Blank line breaks list grouping.
      if (raw.trim() === '') {
        closeList();
        out.push('');
        continue;
      }
      // Plain paragraph line.
      closeList();
      out.push(raw);
    }
    closeList();
    working = out.join('\n');

    // 4. Inline transforms — order matters (bold ** before italic *).
    //    All non-greedy so open-without-close mid-stream renders raw.
    working = working
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
      .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
      // Links — [text](url). URL gets passed through unmodified except
      // for a basic protocol gate so we don't render javascript: URLs.
      .replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);

    // 5. Newlines → <br>, but skip blank lines we already consumed
    //    via list/heading/blockquote handling.
    working = working.replace(/\n/g, '<br>');
    // Collapse runs of <br> from blank-line spacing into a single
    // paragraph break — keeps the output readable.
    working = working.replace(/(<br>\s*){3,}/g, '<br><br>');

    // 6. Restore code blocks (escape THEIR content so user-input
    //    ``` blocks can't smuggle HTML).
    working = working.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_, idx) => {
      const { lang, body } = codeBlocks[Number(idx)];
      const escapedBody = escapeHtml(body);
      const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
      return `<pre class="chat-code-block"><code${langClass}>${escapedBody}</code></pre>`;
    });

    return working;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function destroy() {
    cleanupFns.forEach(fn => fn && fn());
    cleanupFns = [];
    currentAssistantBubble = null;
  }

  return { render, init, destroy };
})();
