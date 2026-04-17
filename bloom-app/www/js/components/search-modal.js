// ─── Global Search Modal ───
// Searches across notes, calendar events, and Bloom conversations.
// Triggered by Cmd/Ctrl+K or the header search icon.
const SearchModal = (() => {
  let overlay = null;
  let searchInput = null;
  let resultsEl = null;
  let allResults = []; // {type, title, subtitle, navigateTo, raw}
  let debounceTimer = null;
  let dataCache = null; // {fetchedAt, notes, events, conversations}
  const CACHE_TTL_MS = 60_000; // refresh data every minute

  function open() {
    if (overlay) {
      searchInput?.focus();
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'search-modal-overlay';
    overlay.innerHTML = `
      <div class="search-modal glass-card">
        <div class="search-modal-input-wrap">
          <svg class="search-modal-icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" class="search-modal-input" id="search-modal-input" placeholder="Search notes, events, conversations..." autocomplete="off">
          <span class="search-modal-hint">esc to close</span>
        </div>
        <div class="search-modal-results" id="search-modal-results">
          <div class="search-modal-empty">Loading workspace...</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    searchInput = document.getElementById('search-modal-input');
    resultsEl = document.getElementById('search-modal-results');

    searchInput.addEventListener('input', onInput);
    searchInput.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onEscapeKey);

    // Focus input + load data in parallel
    setTimeout(() => searchInput?.focus(), 50);
    refreshData().then(() => renderResults(searchInput.value || ''));
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('visible');
    document.removeEventListener('keydown', onEscapeKey);
    setTimeout(() => {
      overlay?.remove();
      overlay = null;
      searchInput = null;
      resultsEl = null;
    }, 200);
  }

  function onEscapeKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function onInput(e) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderResults(e.target.value), 80);
  }

  function onKeydown(e) {
    const items = resultsEl?.querySelectorAll('.search-result-item');
    if (!items || !items.length) return;

    const focused = resultsEl.querySelector('.search-result-item.focused');
    let idx = focused ? Array.from(items).indexOf(focused) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = focused || items[0];
      target?.click();
      return;
    } else {
      return;
    }
    items.forEach(i => i.classList.remove('focused'));
    items[idx]?.classList.add('focused');
    items[idx]?.scrollIntoView({ block: 'nearest' });
  }

  /** Fetch data from notes, calendar, and conversations. Cached for CACHE_TTL_MS. */
  async function refreshData() {
    if (dataCache && Date.now() - dataCache.fetchedAt < CACHE_TTL_MS) return;
    if (!window.electronAPI) {
      dataCache = { fetchedAt: Date.now(), notes: [], events: [], conversations: [] };
      return;
    }

    const [notes, events, conversations] = await Promise.all([
      _fetchNotes().catch(() => []),
      _fetchEvents().catch(() => []),
      window.electronAPI.ai.listConversations().catch(() => [])
    ]);
    dataCache = { fetchedAt: Date.now(), notes, events, conversations };
  }

  /** Fetch notes from the root AllDash Notes folder (top level only for speed). */
  async function _fetchNotes() {
    const items = await window.electronAPI.notes.list();
    return (items || []).filter(item => item.mimeType === 'application/vnd.google-apps.document');
  }

  /** Fetch upcoming events (last 7 days through next 60 days) across all calendars. */
  async function _fetchEvents() {
    const status = await window.electronAPI.google.getStatus();
    if (!status.authenticated) return [];

    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

    const calendars = await window.electronAPI.google.listCalendars();
    const allEvents = [];
    for (const cal of (calendars || [])) {
      try {
        const events = await window.electronAPI.google.listEvents(cal.id, from, to);
        events.forEach(e => allEvents.push({ ...e, calendarId: cal.id, calendarName: cal.summary }));
      } catch {}
    }
    return allEvents;
  }

  function renderResults(query) {
    if (!resultsEl) return;
    const q = (query || '').trim().toLowerCase();
    if (!dataCache) {
      resultsEl.innerHTML = `<div class="search-modal-empty">Loading workspace...</div>`;
      return;
    }

    const results = [];
    const matchScore = (haystack) => {
      if (!haystack) return 0;
      const h = haystack.toLowerCase();
      if (!q) return 1; // show everything when query empty
      if (h === q) return 100;
      if (h.startsWith(q)) return 50;
      if (h.includes(q)) return 25;
      return 0;
    };

    // Notes
    for (const note of dataCache.notes) {
      const score = matchScore(note.name);
      if (score > 0) {
        results.push({
          type: 'note',
          title: note.name,
          subtitle: note.modifiedTime ? `Note · modified ${_relativeTime(note.modifiedTime)}` : 'Note',
          score,
          action: () => {
            close();
            Router.setDeepLink({ type: 'note', id: note.id });
            Router.navigate('notes');
          }
        });
      }
    }

    // Events
    for (const ev of dataCache.events) {
      const summaryScore = matchScore(ev.summary);
      const descScore = matchScore(ev.description) * 0.5;
      const locScore = matchScore(ev.location) * 0.5;
      const score = Math.max(summaryScore, descScore, locScore);
      if (score > 0) {
        const start = ev.start?.dateTime || ev.start?.date;
        const subtitle = start
          ? `Event · ${_formatEventDate(start)}${ev.calendarName ? ' · ' + ev.calendarName : ''}`
          : `Event${ev.calendarName ? ' · ' + ev.calendarName : ''}`;
        results.push({
          type: 'event',
          title: ev.summary || '(untitled event)',
          subtitle,
          score,
          action: () => {
            close();
            Router.setDeepLink({ type: 'event', id: ev.id, date: start, calendarId: ev.calendarId });
            Router.navigate('calendar');
          }
        });
      }
    }

    // Conversations
    for (const conv of dataCache.conversations) {
      const score = matchScore(conv.title);
      if (score > 0) {
        results.push({
          type: 'conversation',
          title: conv.title || 'Untitled chat',
          subtitle: `Bloom chat · ${conv.messageCount || 0} messages · ${_relativeTime(conv.updatedAt)}`,
          score,
          action: () => {
            close();
            Router.setDeepLink({ type: 'conversation', id: conv.id });
            Router.navigate('chat');
          }
        });
      }
    }

    // Sort: highest score first, then alphabetical
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    if (results.length === 0) {
      resultsEl.innerHTML = q
        ? `<div class="search-modal-empty">No results for "<strong>${_escape(q)}</strong>"</div>`
        : `<div class="search-modal-empty">Type to search across notes, events, and conversations.</div>`;
      return;
    }

    // Group by type
    const byType = { note: [], event: [], conversation: [] };
    results.slice(0, 50).forEach(r => byType[r.type].push(r));

    const groupHTML = (label, icon, items) => {
      if (!items.length) return '';
      return `<div class="search-result-group">
        <div class="search-result-group-label">${label} · ${items.length}</div>
        ${items.map(r => `
          <button class="search-result-item" data-action-id="${results.indexOf(r)}">
            <div class="search-result-icon">${icon}</div>
            <div class="search-result-text">
              <div class="search-result-title">${_escape(r.title)}</div>
              <div class="search-result-subtitle">${_escape(r.subtitle)}</div>
            </div>
          </button>`).join('')}
      </div>`;
    };

    const noteIcon = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    const eventIcon = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    const chatIcon = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

    resultsEl.innerHTML =
      groupHTML('Events', eventIcon, byType.event) +
      groupHTML('Notes', noteIcon, byType.note) +
      groupHTML('Bloom chats', chatIcon, byType.conversation);

    // Wire up clicks
    allResults = results;
    resultsEl.querySelectorAll('.search-result-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.actionId, 10);
        allResults[id]?.action?.();
      });
    });
    // Auto-focus first result for keyboard nav
    resultsEl.querySelector('.search-result-item')?.classList.add('focused');
  }

  function _relativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return new Date(iso).toLocaleDateString();
  }

  function _formatEventDate(iso) {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86400000);
    const isToday = d.toDateString() === today.toDateString();
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (isToday) return `today, ${time}`;
    if (isTomorrow) return `tomorrow, ${time}`;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + `, ${time}`;
  }

  function _escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { open, close };
})();
