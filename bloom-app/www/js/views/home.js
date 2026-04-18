// ─── Home View ───
const HomeView = (() => {

  const _welcomeMessages = [
    "Welcome back",
    "Hey there, superstar",
    "Ready to crush it today?",
    "Good to see you again",
    "Let's make today count",
    "Your dashboard awaits",
    "Another great day ahead",
    "Time to get things done",
  ];

  const _bloomGreetings = [
    "Hi there! How can I help you today? ✨",
    "Hey! Ready to be productive? Let's go! 🚀",
    "What's on your mind today? I'm all ears! 💭",
    "Hi! Need help with anything? I've got you! 😊",
    "Let's make today awesome ✨",
    "What can I do for you today? 🌟",
    "Hi! I'm here and ready to help! 💪",
    "Hey! Got any fun plans to organize? 📋",
  ];

  const _quotes = [
    "\"The secret of getting ahead is getting started.\" — Mark Twain",
    "\"Do what you can, with what you have, where you are.\" — Theodore Roosevelt",
    "\"Small daily improvements lead to stunning results.\"",
    "\"Focus on being productive, not busy.\"",
    "\"The best time to plant a tree was 20 years ago. The second best time is now.\"",
    "\"You don't have to be great to start, but you have to start to be great.\"",
    "\"Done is better than perfect.\"",
    "\"Your future is created by what you do today.\"",
    "\"Productivity is never an accident — it's the result of commitment.\"",
    "\"One thing at a time. Most important thing first.\"",
  ];

  const _funFacts = [
    "Fun fact: Honey never spoils — archaeologists found 3000-year-old honey still edible! 🍯",
    "Fun fact: Octopuses have three hearts and blue blood! 🐙",
    "Fun fact: A group of flamingos is called a \"flamboyance\" 🦩",
    "Fun fact: Bananas are technically berries, but strawberries aren't! 🍌",
    "Fun fact: The shortest war in history lasted 38 minutes ⚔️",
    "Fun fact: Wombat poop is cube-shaped 🧊",
    "Fun fact: The inventor of the Pringles can is buried in one 🥫",
    "Fun fact: Cows have best friends and get stressed when separated 🐄",
  ];

  function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Create greeting promise early so splash can wait on it
  let _resolveGreeting;
  window._greetingReady = new Promise(r => { _resolveGreeting = r; });

  // Cache the AI greeting for the lifetime of this session — no re-fetch on every home nav.
  // Burns tokens AND adds API latency to the home transition. Generated once on first
  // home view init, applied directly thereafter.
  // Set to: null (never tried), 'failed' (tried, no result — don't retry), or {title, subtitle, bloom}
  let _cachedGreeting = null;

  // Also cache the randomly-picked FALLBACK strings so they don't change on every
  // home nav (render() re-runs on every view enter — `Math.random()` would
  // produce a new fallback each time, making it look like the greeting is
  // changing even though no API call is happening). Pick once per session.
  const _fallback = {
    welcome: _pick(_welcomeMessages),
    quote: _pick(_quotes),
    bloom: _pick(_bloomGreetings),
    funFact: _pick(_funFacts)
  };

  /** Apply a greeting object (from AI or cache) to the welcome card DOM. */
  function _applyGreeting(greeting) {
    const titleEl = document.getElementById('welcome-title');
    const bloomEl = document.getElementById('bloom-greeting');
    if (titleEl && greeting.title) titleEl.textContent = greeting.title;
    if (bloomEl && greeting.bloom) bloomEl.textContent = greeting.bloom;
    if (greeting.subtitle) {
      const descEl = document.getElementById('welcome-desc');
      if (descEl) {
        const currentStats = descEl.querySelector('span');
        const statsHtml = currentStats ? `<br>${currentStats.outerHTML}` : '';
        descEl.innerHTML = `${_escapeHtml(greeting.subtitle)}${statsHtml}`;
      }
    }
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function _timeAgo(dateStr) {
    const now = Date.now();
    const d = new Date(dateStr).getTime();
    const mins = Math.floor((now - d) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function _formatEventTime(event) {
    const start = event.start?.dateTime || event.start?.date;
    if (!start) return '';
    const d = new Date(start);
    if (event.allDay) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }

  function render() {
    return `
    <div class="dashboard-grid">
      <!-- Welcome Card -->
      <div class="glass-card card-welcome">
        <div class="welcome-content">
          <div class="welcome-text">
            <h2 id="welcome-title">${_fallback.welcome}</h2>
            <p id="welcome-desc" style="font-style:italic;opacity:0.85;">${_fallback.quote}</p>
          </div>
          <div class="welcome-visual">
            <div class="stat-pill" style="cursor:pointer;" data-nav="notes" title="View all notes">
              <div class="stat-num" id="stat-notes">0</div>
              <div class="stat-label">Notes</div>
            </div>
            <div class="stat-pill" style="cursor:pointer;" data-nav="calendar" title="View calendar">
              <div class="stat-num" id="stat-events">0</div>
              <div class="stat-label" data-i18n="events">Events</div>
            </div>
            <div class="stat-pill" style="cursor:pointer;" data-nav="files" title="View all files">
              <div class="stat-num" id="stat-files">0</div>
              <div class="stat-label" data-i18n="files">Files</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Upcoming Events Card -->
      <div class="glass-card card-stats">
        <div class="stats-header" style="cursor:pointer;" data-nav="calendar">
          <h3>Upcoming</h3>
        </div>
        <div class="schedule-list" id="home-upcoming">
          <div class="skeleton-list"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div>
        </div>
      </div>

      <!-- Recent Notes Card -->
      <div class="glass-card card-activity">
        <div class="card-title" style="cursor:pointer;" data-nav="notes">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span>Recent Notes</span>
        </div>
        <div class="activity-list" id="home-notes">
          <div class="skeleton-list"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div>
        </div>
      </div>

      <!-- AI Mascot Card -->
      <div class="glass-card card-mascot">
        <img class="ai-avatar" src="assets/images/bloom-avatar.png" alt="Bloom AI">
        <div class="ai-name" data-i18n="ai_name">Bloom Assistant</div>
        <div class="ai-status">
          <span class="ai-status-dot"></span>
          <span data-i18n="ai_status">Online &middot; Ready to help</span>
        </div>
        <div class="ai-tagline" data-i18n="ai_tagline">Your personal AI companion</div>

        <div class="ai-chat">
          <div class="ai-chat-messages" id="home-chat-messages">
            <div class="chat-bubble assistant" id="bloom-greeting">${_fallback.bloom}</div>
          </div>
          <div class="ai-chat-input">
            <input type="text" id="home-chat-input" placeholder="Ask Bloom anything..." data-i18n-placeholder="chat_placeholder">
            <button class="ai-chat-send" id="home-chat-send">
              <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Recent Drive Files Card -->
      <div class="glass-card card-messages">
        <div class="card-title" style="cursor:pointer;" data-nav="files">
          <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>Recent Files</span>
        </div>
        <div class="message-list" id="home-drive-files">
          <div class="skeleton-list"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div>
        </div>
      </div>

      <!-- Recent Conversations Card -->
      <div class="glass-card card-convos">
        <div class="card-title" style="cursor:pointer;" data-nav="chat">
          <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>Recent Conversations</span>
        </div>
        <div class="files-grid" id="home-conversations">
          <div class="skeleton-list" style="grid-column:1/-1;"><div class="skeleton-row"></div><div class="skeleton-row"></div></div>
        </div>
      </div>
    </div>`;
  }

  // Module-level state for the home chat — survives re-renders when navigating
  // to another view and back. Session-scoped: the active conversation ID lives
  // on `window._activeConversationId`, which is null on app launch and shared
  // with the sidebar ambient panel + main Chat view (see CLAUDE.md "Ambient
  // Bloom Panel"). Together that means: same chat persists within a session,
  // fresh chat on app relaunch.
  let homeChatListenerCleanup = null;

  function init() {
    // Home mini chat
    const chatInput = document.getElementById('home-chat-input');
    const chatSend = document.getElementById('home-chat-send');
    const chatMessages = document.getElementById('home-chat-messages');

    function sendHomeMessage() {
      const text = chatInput?.value.trim();
      if (!text) return;
      chatInput.value = '';
      _appendHomeBubble('user', text);
      if (window.electronAPI) sendToBloom(text, chatMessages);
    }

    chatSend?.addEventListener('click', sendHomeMessage);
    chatInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendHomeMessage();
    });

    // Restore the active conversation into the home chat area, if one exists
    _restoreHomeChat();

    // Wire stream listeners so live responses render here too (even if the
    // request was sent from the sidebar panel on this same conversation)
    _attachHomeStreamListeners();

    // Listen for notes mutations from AI tools → refresh Recent Notes card live
    _attachNotesChangedListener();
    // Same treatment for calendar — when Bloom creates / updates / deletes
    // an event via the AI tools, the Upcoming Events card should update
    // in place without needing a view-switch round-trip.
    _attachCalendarChangedListener();

    loadDashboardData();
  }

  // Shared debounced refetch — Bloom's tool loops often fire several
  // create/update/delete events in rapid succession (e.g. "schedule
  // these 3 meetings"), and each used to trigger a full 4-call
  // dashboard refetch. Coalescing a burst into one refetch keeps the
  // UI live-updating without hammering the APIs.
  let _refetchTimer = null;
  function _debouncedRefetch() {
    clearTimeout(_refetchTimer);
    _refetchTimer = setTimeout(() => {
      _refetchTimer = null;
      loadDashboardData();
    }, 400);
  }

  // Re-fetch when Google sign-in completes from anywhere (setup wizard,
  // settings page, etc.). The home view is usually rendered before the
  // user has connected, so its first loadDashboardData call returns the
  // unauthed placeholders; this event repaints the cards as soon as a
  // token exists.
  window.addEventListener('bloom:google-connected', () => _debouncedRefetch());

  let _notesChangedCleanup = null;
  function _attachNotesChangedListener() {
    if (_notesChangedCleanup) _notesChangedCleanup();
    if (!window.electronAPI?.notes?.onChanged) return;
    _notesChangedCleanup = window.electronAPI.notes.onChanged(_debouncedRefetch);
  }

  let _calendarChangedCleanup = null;
  function _attachCalendarChangedListener() {
    if (_calendarChangedCleanup) _calendarChangedCleanup();
    if (!window.electronAPI?.calendar?.onCalendarChanged) return;
    _calendarChangedCleanup = window.electronAPI.calendar.onCalendarChanged(_debouncedRefetch);
  }

  /** Append a chat bubble to the home chat area. Returns the bubble element. */
  function _appendHomeBubble(role, text) {
    const chatMessages = document.getElementById('home-chat-messages');
    if (!chatMessages) return null;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role === 'assistant' ? 'assistant' : 'user'}`;
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubble;
  }

  /** Pull the active conversation from disk and repaint the home chat.
   *  Called on init so returning to home shows the prior chat instead of a blank slate. */
  async function _restoreHomeChat() {
    if (!window.electronAPI) return;
    const convId = window._activeConversationId;
    if (!convId) return;
    const chatMessages = document.getElementById('home-chat-messages');
    if (!chatMessages) return;

    try {
      const conv = await window.electronAPI.ai.getConversation(convId);
      if (!conv || !conv.messages) return;
      chatMessages.innerHTML = '';
      for (const m of conv.messages) {
        let text = '';
        if (typeof m.content === 'string') {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content.filter(b => b.type === 'text' || typeof b.text === 'string')
                          .map(b => b.text || '').join('');
        }
        if (text.trim()) _appendHomeBubble(m.role === 'assistant' ? 'assistant' : 'user', text);
      }
    } catch (err) {
      console.warn('Failed to restore home chat:', err);
    }
  }

  /** Live stream listeners — render into the home chat area if the event
   *  belongs to the active conversation. Filtered by conversationId so a
   *  sidebar chat on a different conversation doesn't pollute the home view. */
  function _attachHomeStreamListeners() {
    if (homeChatListenerCleanup) homeChatListenerCleanup();
    if (!window.electronAPI?.ai) return;

    let liveAssistantBubble = null;
    let liveAssistantText = '';

    const removeDelta = window.electronAPI.ai.onStreamDelta((data) => {
      if (data.conversationId !== window._activeConversationId) return;
      const chatMessages = document.getElementById('home-chat-messages');
      if (!chatMessages) return;
      // Remove typing indicator if any
      chatMessages.querySelector('.typing-indicator')?.remove();
      if (!liveAssistantBubble) {
        liveAssistantBubble = _appendHomeBubble('assistant', '');
        liveAssistantText = '';
      }
      liveAssistantText += data.text;
      if (liveAssistantBubble) {
        liveAssistantBubble.textContent = liveAssistantText;
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    });

    const removeDone = window.electronAPI.ai.onStreamDone((data) => {
      if (data.conversationId !== window._activeConversationId) return;
      liveAssistantBubble = null;
      liveAssistantText = '';
    });

    const removeError = window.electronAPI.ai.onStreamError((data) => {
      if (data.conversationId && data.conversationId !== window._activeConversationId) return;
      const chatMessages = document.getElementById('home-chat-messages');
      if (!chatMessages) return;
      chatMessages.querySelector('.typing-indicator')?.remove();
      if (liveAssistantBubble) {
        liveAssistantBubble.textContent = liveAssistantText + `\n\n[${data.error || 'error'}]`;
      } else {
        _appendHomeBubble('assistant', `Sorry, ${data.error || 'something went wrong.'}`);
      }
      liveAssistantBubble = null;
      liveAssistantText = '';
    });

    homeChatListenerCleanup = () => {
      try { removeDelta(); } catch {}
      try { removeDone(); } catch {}
      try { removeError(); } catch {}
    };
  }

  async function sendToBloom(text, chatMessages) {
    try {
      const hasAny = await window.electronAPI.ai.hasAnyProvider();
      if (!hasAny) {
        _appendHomeBubble('assistant', 'Set up an AI provider in Settings first — I need a Claude or Gemini key to help.');
        return;
      }

      // Typing indicator (gets removed by the first delta event)
      const typing = document.createElement('div');
      typing.className = 'typing-indicator';
      typing.innerHTML = '<span></span><span></span><span></span>';
      chatMessages.appendChild(typing);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      // Share conversation ID with the sidebar panel + main Chat view
      if (!window._activeConversationId) {
        window._activeConversationId = `conv_${Date.now()}`;
      }

      // Build the full message history from whatever bubbles are currently shown.
      // This mirrors main Chat view's pattern — send the whole history each call
      // so the model has continuity.
      const messages = _collectHomeChatHistory();
      messages.push({ role: 'user', content: text });

      // The stream listeners attached in _attachHomeStreamListeners will handle
      // the response — no duplicate setup here.
      const result = await window.electronAPI.ai.streamChat(messages, window._activeConversationId);
      if (result && result.success === false && result.error !== 'Aborted') {
        typing.remove();
      }
    } catch (err) {
      document.querySelector('#home-chat-messages .typing-indicator')?.remove();
      console.error('Bloom chat error:', err);
    }
  }

  /** Read the current home chat bubbles and return them as a messages array. */
  function _collectHomeChatHistory() {
    const chatMessages = document.getElementById('home-chat-messages');
    if (!chatMessages) return [];
    const msgs = [];
    chatMessages.querySelectorAll('.chat-bubble').forEach(b => {
      const role = b.classList.contains('assistant') ? 'assistant' : 'user';
      const text = b.textContent || '';
      if (text.trim()) msgs.push({ role, content: text });
    });
    return msgs;
  }

  let isActive = true;

  async function loadDashboardData() {
    if (!window.electronAPI) return;
    isActive = true;

    let isAuthenticated = false;
    let eventCount = 0;
    let noteCount = 0;
    let upcomingEvents = [];

    try {
      const status = await window.electronAPI.google.getStatus();
      isAuthenticated = status.authenticated;
    } catch {}

    // Fan out the four remaining independent loads in PARALLEL. The old
    // code awaited upcoming events → recent notes → drive listing →
    // recent files → conversations → greeting serially, gating first
    // paint of the dashboard behind 6 round trips (several minutes of
    // latency over a cold Drive cache). Each section below updates its
    // own DOM target independently, so Promise.allSettled lets each
    // card render as soon as its own data lands.
    const sections = [];

    // ── Upcoming events ──
    sections.push((async () => {
    if (isAuthenticated) {
      try {
        const now = new Date();
        const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const events = await window.electronAPI.google.listEvents('primary', now.toISOString(), weekEnd.toISOString());
        eventCount = events.length;
        upcomingEvents = events.slice(0, 5);

        const eventsEl = document.getElementById('stat-events');
        if (eventsEl) eventsEl.textContent = eventCount;

        const upcomingEl = document.getElementById('home-upcoming');
        if (upcomingEl) {
          if (upcomingEvents.length === 0) {
            upcomingEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">No upcoming events this week</div>`;
          } else {
            const colors = ['var(--accent-pink)', 'var(--accent-rose)', 'var(--accent-warm)', 'var(--accent-blush)', 'var(--accent-pink)'];
            upcomingEl.innerHTML = upcomingEvents.map((e, i) => {
              const start = e.start?.dateTime || e.start?.date || '';
              return `
              <div class="schedule-item" style="border-left-color:${colors[i % colors.length]};cursor:pointer;" data-deep="event" data-id="${e.id}" data-date="${start}" data-cal="${e.calendarId || 'primary'}">
                <div class="sched-title">${_escapeHtml(e.summary)}</div>
                <div class="sched-time">${_formatEventTime(e)}</div>
              </div>`;
            }).join('');
            upcomingEl.querySelectorAll('[data-deep="event"]').forEach(el => {
              el.addEventListener('click', () => {
                Router.setDeepLink({ type: 'event', id: el.dataset.id, date: el.dataset.date, calendarId: el.dataset.cal });
                Router.navigate('calendar');
              });
            });
          }
        }
      } catch {
        const upcomingEl = document.getElementById('home-upcoming');
        if (upcomingEl) upcomingEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">Connect Google to see events</div>`;
      }
    } else {
      const upcomingEl = document.getElementById('home-upcoming');
      if (upcomingEl) upcomingEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">Connect Google to see events</div>`;
    }
    })());

    // ── Recent notes ──
    sections.push((async () => {
    if (isAuthenticated) {
      try {
        const allNoteItems = await window.electronAPI.notes.list();
        // Filter to documents only — folders shouldn't appear in
        // the "Recent Notes" card or inflate the note counter.
        const notes = allNoteItems.filter(n => n.type === 'document');
        noteCount = notes.length;
        const notesEl = document.getElementById('stat-notes');
        if (notesEl) notesEl.textContent = noteCount;

        const homeNotes = document.getElementById('home-notes');
        if (homeNotes) {
          if (notes.length === 0) {
            homeNotes.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">No notes yet</div>`;
          } else {
            const dots = ['pink', 'rose', 'warm'];
            homeNotes.innerHTML = notes.slice(0, 4).map((n, i) => `
              <div class="activity-item" style="cursor:pointer;" data-deep="note" data-id="${n.id}">
                <div class="activity-dot ${dots[i % dots.length]}"></div>
                <div class="activity-info">
                  <div class="activity-name">${_escapeHtml(n.title)}</div>
                  <div class="activity-time">${_timeAgo(n.modifiedTime)}</div>
                </div>
              </div>
            `).join('');
            homeNotes.querySelectorAll('[data-deep="note"]').forEach(el => {
              el.addEventListener('click', () => {
                Router.setDeepLink({ type: 'note', id: el.dataset.id });
                Router.navigate('notes');
              });
            });
          }
        }
      } catch {
        const homeNotes = document.getElementById('home-notes');
        if (homeNotes) homeNotes.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">Connect Google to see notes</div>`;
      }
    } else {
      const homeNotes = document.getElementById('home-notes');
      if (homeNotes) homeNotes.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">Connect Google to see notes</div>`;
    }
    })());

    // ── Recent Drive files ──
    sections.push((async () => {
    // Driven by the user's actual click history (window.electronAPI.recent),
    // NOT "first 4 files in Drive root" — the old behavior was misleading
    // because it changed when Drive's listing changed, and rarely showed
    // anything you'd actually opened. Empty state copy invites the user to
    // click around the Files view to populate it.
    //
    // We still update the `stat-files` counter from a Drive root listing
    // because that's a "total files in Drive" number, separate from "what
    // you've recently opened".
    if (isAuthenticated) {
      // Counter: total files in Drive root (best-effort; doesn't gate the rest)
      try {
        const files = await window.electronAPI.drive.listFiles('root', 10);
        const filesEl = document.getElementById('stat-files');
        if (filesEl) filesEl.textContent = files.length;
      } catch {}

      try {
        const recentFiles = await window.electronAPI.recent.list({ kind: 'file', limit: 4 });
        const homeDrive = document.getElementById('home-drive-files');
        if (homeDrive) {
          if (recentFiles.length === 0) {
            homeDrive.innerHTML = `
              <div style="text-align:center;padding:24px 16px;color:var(--text-muted);font-size:11px;font-weight:300;line-height:1.6;">
                <svg viewBox="0 0 24 24" width="28" height="28" stroke="var(--accent-blush)" stroke-width="1.4" fill="none" style="opacity:0.4;margin-bottom:8px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <div>Files you open will appear here.</div>
                <div style="margin-top:6px;"><a href="#" id="home-files-browse-link" style="color:var(--accent-pink);text-decoration:none;">Browse your Drive →</a></div>
              </div>`;
            document.getElementById('home-files-browse-link')?.addEventListener('click', (e) => {
              e.preventDefault();
              Router.navigate('files');
            });
          } else {
            const gradients = [
              'linear-gradient(135deg, var(--accent-pink), var(--accent-rose))',
              'linear-gradient(135deg, var(--accent-warm), var(--accent-pink))',
              'linear-gradient(135deg, var(--accent-blush), var(--accent-rose))',
            ];
            homeDrive.innerHTML = recentFiles.map((f, i) => {
              const ext = (f.name || '').split('.').pop()?.toUpperCase() || 'FILE';
              const initials = ext.slice(0, 2);
              return `
              <div class="message-item" style="cursor:pointer;" data-deep="file" data-id="${_escapeHtml(f.id)}" data-name="${_escapeHtml(f.name || '')}" data-mime="${_escapeHtml(f.mimeType || '')}" data-link="${_escapeHtml(f.webViewLink || '')}">
                <div class="msg-avatar" style="background:${gradients[i % gradients.length]};width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;flex-shrink:0;">${_escapeHtml(initials)}</div>
                <div class="msg-content">
                  <div class="msg-name">${_escapeHtml(f.name || 'Untitled')}</div>
                  <div class="msg-text">Opened ${_timeAgo(f.accessedAt)}</div>
                </div>
              </div>`;
            }).join('');
            homeDrive.querySelectorAll('[data-deep="file"]').forEach(el => {
              el.addEventListener('click', () => {
                Router.setDeepLink({ type: 'file', id: el.dataset.id, name: el.dataset.name, mime: el.dataset.mime, link: el.dataset.link });
                Router.navigate('files');
              });
            });
          }
        }
      } catch {
        const homeDrive = document.getElementById('home-drive-files');
        if (homeDrive) homeDrive.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">Couldn\u2019t load recent files.</div>`;
      }
    } else {
      const homeDrive = document.getElementById('home-drive-files');
      if (homeDrive) homeDrive.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">Connect Google to see files</div>`;
    }
    })());

    // ── Recent conversations ──
    sections.push((async () => {
    try {
      const convos = await window.electronAPI.claude.listConversations();
      const homeConvos = document.getElementById('home-conversations');
      if (homeConvos) {
        if (convos.length === 0) {
          homeConvos.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">No conversations yet. Chat with Bloom to get started.</div>`;
        } else {
          homeConvos.innerHTML = convos.slice(0, 4).map(c => `
            <div class="file-item" style="cursor:pointer;" data-deep="convo" data-id="${c.id}">
              <div class="file-icon doc">
                <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <div class="file-info">
                <div class="file-name">${_escapeHtml(c.title || 'Conversation')}</div>
                <div class="file-size">${c.messageCount || 0} messages</div>
              </div>
            </div>
          `).join('');
          homeConvos.querySelectorAll('[data-deep="convo"]').forEach(el => {
            el.addEventListener('click', () => {
              Router.setDeepLink({ type: 'conversation', id: el.dataset.id });
              Router.navigate('chat');
            });
          });
        }
      }
    } catch {
      const homeConvos = document.getElementById('home-conversations');
      if (homeConvos) homeConvos.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">No conversations yet</div>`;
    }
    })());

    // Wait for all four section loaders before firing the greeting —
    // greeting doesn't need the data, but keeping the loop sequenced
    // this way means `isActive` can't flip during a mid-flight load.
    // Promise.allSettled so one failing section never blocks the rest.
    await Promise.allSettled(sections);

    // ── AI-generated greeting (splash waits for this via _resolveGreeting) ──
    // Use cached greeting if already fetched this session (no re-fetch on every home nav)
    if (_cachedGreeting && _cachedGreeting !== 'failed') {
      _applyGreeting(_cachedGreeting);
      _resolveGreeting();
    } else if (_cachedGreeting === 'failed') {
      // Already tried this session and got nothing — don't retry, keep fallback strings
      _resolveGreeting();
    } else if (window.electronAPI) {
      // First home visit this session — fetch once, cache the result
      window.electronAPI.ai.generateGreeting().then(greeting => {
        if (!greeting) {
          _cachedGreeting = 'failed';
          _resolveGreeting();
          return;
        }
        _cachedGreeting = greeting;
        if (isActive) _applyGreeting(greeting);
        _resolveGreeting();
      }).catch(() => {
        _cachedGreeting = 'failed';
        _resolveGreeting();
      });
    } else {
      _resolveGreeting();
    }

    // ── Welcome subtitle — keep the fun greeting, add data summary below ──
    const descEl = document.getElementById('welcome-desc');
    if (descEl) {
      const funLine = descEl.textContent; // Keep the quote/fun fact
      if (isAuthenticated) {
        const nextEvent = upcomingEvents[0];
        let stats = `📊 ${noteCount} note${noteCount !== 1 ? 's' : ''} · ${eventCount} event${eventCount !== 1 ? 's' : ''} this week`;
        if (nextEvent) stats += ` · Next: ${nextEvent.summary}`;
        descEl.innerHTML = `${_escapeHtml(funLine)}<br><span style="font-style:normal;opacity:1;font-size:11px;">${stats}</span>`;
      }
    }
  }

  function destroy() {
    isActive = false;
    // Detach listeners on navigation away — they'll be re-attached by init on return.
    if (homeChatListenerCleanup) { homeChatListenerCleanup(); homeChatListenerCleanup = null; }
    if (_notesChangedCleanup) { _notesChangedCleanup(); _notesChangedCleanup = null; }
    if (_calendarChangedCleanup) { _calendarChangedCleanup(); _calendarChangedCleanup = null; }
  }

  return { render, init, destroy };
})();
