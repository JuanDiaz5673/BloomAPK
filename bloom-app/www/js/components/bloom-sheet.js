// ─── Bloom bottom-sheet (mobile chat surface) ───────────────────────
//
// Mobile equivalent of the ambient Bloom side-panel that lives in
// the desktop sidebar. A bottom sheet that slides up from the FAB
// with three states: hidden, default (55vh), expanded (92vh). Drag
// the grab handle to expand/collapse, tap overlay to close, tap the
// FAB to toggle.
//
// Reuses the existing AI stream event surface
// (window.electronAPI.ai.onStreamDelta / onStreamDone / onStreamError)
// — when those become real Capacitor plugin calls later, this sheet
// will start showing real responses without any code change here.
// Until then, the bridge stubs return null/no-op and the sheet
// displays a friendly empty state.

const BloomSheet = (() => {
  let _sheet = null;
  let _overlay = null;
  let _messagesEl = null;
  let _inputEl = null;
  let _isOpen = false;
  let _isExpanded = false;
  let _cleanupFns = [];

  function _mount() {
    if (_sheet) return;

    _overlay = document.createElement('div');
    _overlay.className = 'bloom-sheet-overlay';
    _overlay.addEventListener('click', close);
    document.body.appendChild(_overlay);

    _sheet = document.createElement('div');
    _sheet.className = 'bloom-sheet';
    _sheet.setAttribute('role', 'dialog');
    _sheet.setAttribute('aria-label', 'Bloom chat');
    _sheet.innerHTML = `
      <div class="bloom-sheet-grab" id="bloom-sheet-grab" aria-hidden="true"></div>
      <div class="bloom-sheet-header">
        <img src="assets/images/bloom-avatar.png" alt="" class="bloom-sheet-avatar">
        <div style="flex:1;min-width:0;">
          <div class="bloom-sheet-title">Bloom</div>
          <div class="bloom-sheet-title-sub">Ambient chat</div>
        </div>
        <button class="bloom-sheet-expand" id="bloom-sheet-expand" aria-label="Expand">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="bloom-sheet-close" id="bloom-sheet-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="bloom-sheet-messages" id="bloom-sheet-messages">
        <div class="bloom-sheet-empty">
          Once you set up an AI key in Settings, Bloom can help from here.
        </div>
      </div>
      <div class="bloom-sheet-input-area">
        <textarea id="bloom-sheet-input" rows="1" placeholder="Ask Bloom..."></textarea>
        <button id="bloom-sheet-send" aria-label="Send message">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>`;
    document.body.appendChild(_sheet);

    _messagesEl = _sheet.querySelector('#bloom-sheet-messages');
    _inputEl = _sheet.querySelector('#bloom-sheet-input');

    _sheet.querySelector('#bloom-sheet-close').addEventListener('click', close);
    _sheet.querySelector('#bloom-sheet-expand').addEventListener('click', _toggleExpand);
    _sheet.querySelector('#bloom-sheet-send').addEventListener('click', _send);

    // Auto-grow textarea
    let _resizePending = false;
    _inputEl.addEventListener('input', () => {
      if (_resizePending) return;
      _resizePending = true;
      requestAnimationFrame(() => {
        _resizePending = false;
        _inputEl.style.height = 'auto';
        _inputEl.style.height = Math.min(_inputEl.scrollHeight, 120) + 'px';
      });
    });

    // Enter to send
    _inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _send();
      }
    });

    // Grab-handle drag → expand/collapse
    _setupGrabDrag(_sheet.querySelector('#bloom-sheet-grab'));

    // Listen for stream events so if/when the backend wires up, the
    // sheet shows live responses without needing a rewrite.
    if (window.electronAPI?.ai?.onStreamDelta) {
      _cleanupFns.push(window.electronAPI.ai.onStreamDelta(_onDelta));
    }
    if (window.electronAPI?.ai?.onStreamDone) {
      _cleanupFns.push(window.electronAPI.ai.onStreamDone(_onDone));
    }
    if (window.electronAPI?.ai?.onStreamError) {
      _cleanupFns.push(window.electronAPI.ai.onStreamError(_onError));
    }
  }

  function open() {
    _mount();
    _isOpen = true;
    requestAnimationFrame(() => {
      _sheet.classList.add('open');
      _overlay.classList.add('open');
      document.body.classList.add('bloom-sheet-open');
    });
    // Focus the input so the keyboard pops and the user can type.
    // Slight delay so the slide-up finishes before the IME eats the frame.
    setTimeout(() => _inputEl?.focus(), 320);
  }

  function close() {
    if (!_sheet) return;
    _isOpen = false;
    _isExpanded = false;
    _sheet.classList.remove('open', 'expanded');
    _overlay.classList.remove('open');
    document.body.classList.remove('bloom-sheet-open');
    if (document.activeElement === _inputEl) _inputEl.blur();
  }

  function toggle() {
    if (_isOpen) close(); else open();
  }

  function _toggleExpand() {
    if (!_sheet) return;
    _isExpanded = !_isExpanded;
    _sheet.classList.toggle('expanded', _isExpanded);
    // Flip the chevron direction
    const icon = _sheet.querySelector('#bloom-sheet-expand svg polyline');
    if (icon) {
      icon.setAttribute('points', _isExpanded ? '6 9 12 15 18 9' : '18 15 12 9 6 15');
    }
  }

  // ── Grab-handle drag ────────────────────────────────────────────
  function _setupGrabDrag(handle) {
    let startY = 0;
    let startHeight = 0;
    let dragging = false;

    const getHeight = () => _sheet.getBoundingClientRect().height;

    const onStart = (e) => {
      dragging = true;
      startY = (e.touches ? e.touches[0].clientY : e.clientY);
      startHeight = getHeight();
      _sheet.style.transition = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      const y = (e.touches ? e.touches[0].clientY : e.clientY);
      const delta = startY - y; // positive = dragging up
      const newH = Math.max(0, Math.min(window.innerHeight * 0.92, startHeight + delta));
      _sheet.style.height = newH + 'px';
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      _sheet.style.transition = '';
      const h = getHeight();
      const vh = window.innerHeight;
      // Dragged past 80% → expand. Below 30vh → close. Else snap to default.
      if (h > vh * 0.8) {
        _isExpanded = true;
        _sheet.classList.add('expanded');
        _sheet.style.height = '';
      } else if (h < vh * 0.3) {
        _sheet.style.height = '';
        close();
      } else {
        _isExpanded = false;
        _sheet.classList.remove('expanded');
        _sheet.style.height = '';
      }
    };

    // Attach move/end only while a drag is active. Two wins:
    //  1. No document-level listener leak across re-mounts.
    //  2. touchmove with `passive:false` can preventDefault while
    //     dragging so the sheet doesn't fight the messages' native scroll.
    // Declarations ordered so any forward-reference is impossible: the
    // three handler fns exist before attach/detach reference them.
    const onMoveMouse = (e) => onMove(e);
    const onMoveTouch = (e) => { e.preventDefault(); onMove(e); };
    const onEndOnce = () => { onEnd(); detachDragging(); };
    function attachWhileDragging() {
      document.addEventListener('mousemove', onMoveMouse);
      document.addEventListener('mouseup', onEndOnce);
      document.addEventListener('touchmove', onMoveTouch, { passive: false });
      document.addEventListener('touchend', onEndOnce);
      document.addEventListener('touchcancel', onEndOnce);
    }
    function detachDragging() {
      document.removeEventListener('mousemove', onMoveMouse);
      document.removeEventListener('mouseup', onEndOnce);
      document.removeEventListener('touchmove', onMoveTouch);
      document.removeEventListener('touchend', onEndOnce);
      document.removeEventListener('touchcancel', onEndOnce);
    }

    handle.addEventListener('mousedown', (e) => { onStart(e); attachWhileDragging(); });
    handle.addEventListener('touchstart', (e) => { onStart(e); attachWhileDragging(); }, { passive: true });
  }

  // ── Send / stream handling ───────────────────────────────────────
  // Mirrors the desktop bloom-panel.js send path but against the
  // mobile sheet's DOM. Real streaming lights up when the bridge's
  // ai.streamChat is replaced with a real implementation.
  let _currentAssistantBubble = null;
  // Does the in-flight assistant bubble actually have content yet?
  // Read back at _onDone time from the bubble itself instead of
  // maintaining a parallel string accumulator (which was allocating
  // the full reply twice: once into the DOM, once into this string).
  let _assistantHasContent = false;
  // In-memory chat history, keyed to _historyConvoId. Previously we
  // scraped bubble textContent each send, which both (a) lost any
  // markdown/code the assistant streamed and (b) could pick up stray
  // matching nodes in the page. Track canonical role+string pairs
  // here, but reset whenever the conversation id changes (or the
  // sheet closes) so a stale chat doesn't ride into a fresh convo.
  let _history = [];
  let _historyConvoId = null;

  async function _send() {
    const text = _inputEl.value.trim();
    if (!text) return;
    _inputEl.value = '';
    _inputEl.style.height = 'auto';
    _appendBubble('user', text);

    if (!window.electronAPI?.ai?.streamChat) return;

    const convoId = window._activeConversationId || ('m_' + Date.now());
    window._activeConversationId = convoId;
    // Rebind history to the active convo. If the convoId changed since
    // the last send (e.g. the user navigated and a new m_<ts> was
    // minted) the previous turns are irrelevant to this thread.
    if (_historyConvoId !== convoId) {
      _history = [];
      _historyConvoId = convoId;
    }
    _history.push({ role: 'user', content: text });
    try {
      // Clone so providers' filter/map can't mutate our history state.
      await window.electronAPI.ai.streamChat(_history.slice(), convoId);
    } catch (err) {
      // The user turn is already in history but no assistant reply
      // will follow — leaving it would produce a [user, user, …]
      // sequence on the next send, which Claude rejects outright
      // (strict user/assistant alternation).
      _history.pop();
      _appendBubble('assistant', 'Something went wrong. Try again?');
    }
  }

  function _appendBubble(role, text) {
    // First real message replaces the empty state
    const empty = _messagesEl.querySelector('.bloom-sheet-empty');
    if (empty) empty.remove();
    const bubble = document.createElement('div');
    bubble.className = `bloom-sheet-msg ${role}`;
    bubble.setAttribute('data-role', role);
    bubble.textContent = text || '';
    _messagesEl.appendChild(bubble);
    _scrollToBottom();
    return bubble;
  }

  function _scrollToBottom() {
    _messagesEl.scrollTop = _messagesEl.scrollHeight;
  }

  function _onDelta(data) {
    if (!_isOpen) return;
    if (data?.conversationId !== window._activeConversationId) return;
    const chunk = data.text || '';
    if (!chunk) return;
    if (!_currentAssistantBubble) {
      _currentAssistantBubble = _appendBubble('assistant', '');
      _assistantHasContent = false;
    }
    // Append a text node instead of rewriting textContent each delta —
    // rewriting the whole string per tick is O(n²) across a long reply
    // and forced a layout + repaint every ~20ms while streaming.
    _currentAssistantBubble.appendChild(document.createTextNode(chunk));
    _assistantHasContent = true;
    _scrollToBottom();
  }

  function _onDone() {
    // Commit the streamed assistant reply to history so it carries into
    // the next turn's prompt. Read the final text from the bubble
    // itself — avoids maintaining a parallel accumulator.
    if (_assistantHasContent && _currentAssistantBubble) {
      _history.push({
        role: 'assistant',
        content: _currentAssistantBubble.textContent || '',
      });
    }
    _currentAssistantBubble = null;
    _assistantHasContent = false;
  }

  function _onError(data) {
    _appendBubble('assistant', `Error: ${data?.error || 'unknown'}`);
    _currentAssistantBubble = null;
    _assistantHasContent = false;
    // Roll back the user turn that won't get an assistant reply so we
    // keep strict user/assistant alternation in history.
    if (_history.length && _history[_history.length - 1].role === 'user') {
      _history.pop();
    }
  }

  return { open, close, toggle };
})();
