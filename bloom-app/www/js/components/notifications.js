// ─── Notifications Popover ───
// Surfaces upcoming calendar events as time-based reminders. Dot badge on the
// header bell when there's an event in the next ~24 hours.
const Notifications = (() => {
  let popover = null;
  let lastRefresh = 0;
  const REFRESH_TTL_MS = 60_000;
  const HORIZON_HOURS = 24 * 7; // surface anything in next 7 days
  const SOON_HOURS = 24;        // badge if anything within 24h
  let cache = []; // upcoming events sorted by start time

  // Refresh-loop interval handle. Tracked so destroy() can clear it on
  // teardown (preventing the timer from holding references after a hot-reload
  // / extension reset and from doing redundant Drive queries on a stale tab).
  let _refreshInterval = null;

  /** Initial setup — start the badge poll loop. Called by app.js after Header.init. */
  function init() {
    refreshBadge();
    // Re-check every 5 minutes. Stash the handle so destroy() can clear it.
    if (_refreshInterval) clearInterval(_refreshInterval);
    _refreshInterval = setInterval(refreshBadge, 5 * 60 * 1000);
  }

  /** Tear down the refresh loop + close any open popover. Called from
   *  app.js if the user signs out or the app is being shut down. */
  function destroy() {
    if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }
    close();
  }

  async function _fetchUpcomingEvents() {
    if (!window.electronAPI) return [];
    try {
      const status = await window.electronAPI.google.getStatus();
      if (!status.authenticated) return [];

      const now = new Date();
      const horizon = new Date(now.getTime() + HORIZON_HOURS * 60 * 60 * 1000);
      const calendars = await window.electronAPI.google.listCalendars();
      const events = [];
      for (const cal of (calendars || [])) {
        // Skip holiday calendars — too noisy
        if (cal.id?.includes('holiday')) continue;
        try {
          const evs = await window.electronAPI.google.listEvents(cal.id, now.toISOString(), horizon.toISOString());
          evs.forEach(e => events.push({ ...e, calendarId: cal.id, calendarName: cal.summary, calendarColor: cal.backgroundColor }));
        } catch {}
      }
      // Filter to events that haven't started yet, sort by start time
      const upcoming = events.filter(e => {
        const start = e.start?.dateTime || e.start?.date;
        return start && new Date(start).getTime() > now.getTime();
      });
      upcoming.sort((a, b) => {
        const aStart = new Date(a.start?.dateTime || a.start?.date).getTime();
        const bStart = new Date(b.start?.dateTime || b.start?.date).getTime();
        return aStart - bStart;
      });
      return upcoming;
    } catch {
      return [];
    }
  }

  async function refreshBadge() {
    cache = await _fetchUpcomingEvents();
    lastRefresh = Date.now();
    _updateBellState();
  }

  /**
   * Update the bell icon's visual state based on cached events:
   *   - empty:   outline bell, muted (no upcoming events anywhere in the horizon)
   *   - has:     filled bell, secondary color (events upcoming but none soon)
   *   - soon:    filled bell + pink dot badge (event within SOON_HOURS)
   */
  function _updateBellState() {
    const btn = document.getElementById('btn-notifications');
    const badge = document.getElementById('notifications-badge');
    if (!btn) return;

    const soonCutoff = Date.now() + SOON_HOURS * 60 * 60 * 1000;
    const hasAny = cache.length > 0;
    const hasSoon = cache.some(e => {
      const start = new Date(e.start?.dateTime || e.start?.date).getTime();
      return start <= soonCutoff;
    });

    btn.classList.toggle('notifications-empty', !hasAny);
    btn.classList.toggle('notifications-has', hasAny);
    btn.classList.toggle('notifications-soon', hasSoon);

    if (badge) badge.style.display = hasSoon ? 'block' : 'none';

    // Bell icon stays as static HTML paths (no innerHTML swap — that breaks SVG
    // rendering in Chromium). The outline→filled visual change is handled entirely
    // by CSS: #btn-notifications.notifications-has svg path:first-of-type { fill }
  }

  /** Open or close the popover; if anchorEl is provided, position relative to it. */
  async function toggle(anchorEl) {
    if (popover) {
      close();
      return;
    }
    await open(anchorEl);
  }

  async function open(anchorEl) {
    popover = document.createElement('div');
    popover.className = 'notifications-popover glass-card';
    popover.innerHTML = `
      <div class="notifications-header">
        <div class="notifications-title">Upcoming</div>
        <button class="notifications-close" id="notif-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="notifications-body" id="notifications-body">
        <div class="notifications-empty">Loading...</div>
      </div>`;
    document.body.appendChild(popover);

    // Position below the anchor (header bell), right-aligned to it
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      const popoverWidth = 340;
      const right = Math.max(12, window.innerWidth - r.right);
      popover.style.top = `${Math.round(r.bottom + 10)}px`;
      popover.style.right = `${right}px`;
      popover.style.width = `${popoverWidth}px`;
    } else {
      popover.style.top = '64px';
      popover.style.right = '20px';
      popover.style.width = '340px';
    }

    requestAnimationFrame(() => popover.classList.add('visible'));

    document.getElementById('notif-close')?.addEventListener('click', close);
    document.addEventListener('click', onOutsideClick, { capture: true });
    document.addEventListener('keydown', onEscape);

    // Refresh data if stale, then render
    if (Date.now() - lastRefresh > REFRESH_TTL_MS || cache.length === 0) {
      await refreshBadge();
    }
    renderBody();
  }

  function close() {
    if (!popover) return;
    popover.classList.remove('visible');
    document.removeEventListener('click', onOutsideClick, { capture: true });
    document.removeEventListener('keydown', onEscape);
    setTimeout(() => {
      popover?.remove();
      popover = null;
    }, 180);
  }

  function onOutsideClick(e) {
    if (!popover) return;
    // Don't close if clicking the bell button (it has its own toggle handler)
    if (popover.contains(e.target)) return;
    if (e.target.closest('#btn-notifications')) return;
    close();
  }

  function onEscape(e) {
    if (e.key === 'Escape') close();
  }

  function renderBody() {
    const body = document.getElementById('notifications-body');
    if (!body) return;

    if (!cache.length) {
      body.innerHTML = `
        <div class="notifications-empty">
          <svg viewBox="0 0 24 24" width="32" height="32" stroke="var(--text-muted)" stroke-width="1.5" fill="none" style="opacity:0.5;margin-bottom:8px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <div>Nothing on your calendar in the next 7 days.</div>
        </div>`;
      return;
    }

    // Group: Today, Tomorrow, This week
    const groups = { today: [], tomorrow: [], later: [] };
    const now = new Date();
    const todayStr = now.toDateString();
    const tomorrowStr = new Date(now.getTime() + 86400000).toDateString();
    for (const ev of cache) {
      const startStr = ev.start?.dateTime || ev.start?.date;
      const start = new Date(startStr);
      const startDateStr = start.toDateString();
      if (startDateStr === todayStr) groups.today.push(ev);
      else if (startDateStr === tomorrowStr) groups.tomorrow.push(ev);
      else groups.later.push(ev);
    }

    const renderGroup = (label, items) => {
      if (!items.length) return '';
      return `
        <div class="notifications-group-label">${label}</div>
        ${items.map(ev => renderEvent(ev)).join('')}`;
    };

    body.innerHTML =
      renderGroup('Today', groups.today) +
      renderGroup('Tomorrow', groups.tomorrow) +
      renderGroup('Later this week', groups.later) +
      `<div class="notifications-footer">
        <button class="notifications-link" id="notif-view-all">View all in calendar →</button>
      </div>`;

    document.getElementById('notif-view-all')?.addEventListener('click', () => {
      close();
      Router.navigate('calendar');
    });
    body.querySelectorAll('.notification-item').forEach((item, idx) => {
      item.addEventListener('click', () => {
        close();
        const ev = cache[idx];
        if (ev?.id) {
          const start = ev.start?.dateTime || ev.start?.date;
          Router.setDeepLink({ type: 'event', id: ev.id, date: start, calendarId: ev.calendarId });
        }
        Router.navigate('calendar');
      });
    });
  }

  function renderEvent(ev) {
    const start = ev.start?.dateTime || ev.start?.date;
    const isAllDay = !ev.start?.dateTime;
    const startDate = new Date(start);
    const minutesUntil = Math.round((startDate.getTime() - Date.now()) / 60000);
    let timeLabel;
    if (isAllDay) {
      timeLabel = 'All day';
    } else if (minutesUntil < 60) {
      timeLabel = `in ${Math.max(minutesUntil, 1)} min`;
    } else if (minutesUntil < 24 * 60) {
      const h = Math.round(minutesUntil / 60);
      timeLabel = `in ${h}h`;
    } else {
      timeLabel = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    const isUrgent = !isAllDay && minutesUntil < 60;

    return `
      <button class="notification-item ${isUrgent ? 'urgent' : ''}">
        <div class="notification-dot" style="background:${ev.calendarColor || 'var(--accent-pink)'};"></div>
        <div class="notification-text">
          <div class="notification-title">${_escape(ev.summary || '(untitled)')}</div>
          <div class="notification-meta">${_escape(timeLabel)}${ev.location ? ' · ' + _escape(ev.location) : ''}</div>
        </div>
      </button>`;
  }

  function _escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { init, toggle, refreshBadge, destroy };
})();
