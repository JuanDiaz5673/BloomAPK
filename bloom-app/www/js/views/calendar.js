// ─── Calendar View ───
const CalendarView = (() => {
  let calendarInstance = null;
  let currentViewType = 'dayGridMonth';
  // Handles tracked here so destroy() can tear them down. Previously the
  // sidebar listeners + ResizeObserver leaked on every view visit — after
  // 10 back-and-forth navigations you had 10 rAF loops all calling
  // updateSize() on destroyed calendar instances.
  let _sidebarEl = null;
  let _onSidebarMouse = null;
  let _onDocSidebarChange = null;
  let _resizeObserver = null;
  let _animFrameId = null;

  function render() {
    return `
    <div class="calendar-view">
      <div class="glass-card" style="animation:fadeSlideUp 0.5s ease 0.05s both;padding:12px 16px;">
        <div class="calendar-toolbar">
          <div class="calendar-nav">
            <button class="calendar-nav-btn" id="cal-prev">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--text-secondary)" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="calendar-nav-btn" id="cal-today" style="width:auto;padding:0 16px;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">Today</button>
            <button class="calendar-nav-btn" id="cal-next">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--text-secondary)" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <span class="calendar-title" id="cal-title"></span>
          </div>
          <div class="calendar-view-toggle">
            <button class="view-toggle-btn active" data-cal-view="dayGridMonth">Month</button>
            <button class="view-toggle-btn" data-cal-view="timeGridWeek">Week</button>
            <button class="view-toggle-btn" data-cal-view="timeGridDay">Day</button>
          </div>
        </div>
      </div>
      <div class="glass-card" style="flex:1;min-height:0;overflow:hidden;padding:0;animation:fadeSlideUp 0.6s ease 0.15s both;">
        <div class="calendar-container" id="calendar-container"></div>
      </div>
      <!-- Mobile-only: events for the selected day. Hidden on desktop via mobile.css scope. -->
      <div class="mobile-day-events" id="mobile-day-events" style="display:none;">
        <div class="mobile-day-events-title" id="mobile-day-events-title">Today</div>
        <span class="mobile-day-events-count" id="mobile-day-events-count"></span>
        <div id="mobile-day-events-list"></div>
      </div>
    </div>

    <!-- Event Modal -->
    <div class="event-modal-overlay" id="event-modal" style="display:none;">
      <div class="event-modal glass-card" style="border-radius:20px;padding:28px;">
        <h3 id="event-modal-title" style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:400;margin-bottom:20px;background:linear-gradient(135deg,#fff 30%,var(--accent-blush));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">New Event</h3>
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="event-title" placeholder="Event title...">
        </div>
        <div class="form-group">
          <label>Start</label>
          <input type="datetime-local" id="event-start">
        </div>
        <div class="form-group">
          <label>End</label>
          <input type="datetime-local" id="event-end">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="event-description" placeholder="Optional description..."></textarea>
        </div>
        <div class="event-modal-actions">
          <button class="btn-glass" id="event-cancel">Cancel</button>
          <button class="btn-glass btn-sm danger" id="event-delete" style="display:none;">Delete</button>
          <button class="btn-pink" id="event-save">Save</button>
        </div>
      </div>
    </div>`;
  }

  async function init() {
    const el = document.getElementById('calendar-container');
    if (!el) return;

    // Check Google auth first
    let isAuthenticated = false;
    if (window.electronAPI) {
      try {
        const status = await window.electronAPI.google.getStatus();
        isAuthenticated = status.authenticated;
      } catch {}
    }

    if (!isAuthenticated) {
      el.innerHTML = `<div style="padding:60px 40px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;">
        <svg viewBox="0 0 24 24" width="56" height="56" stroke="var(--accent-blush)" stroke-width="1" fill="none" style="opacity:0.4;animation:float 4s ease-in-out infinite;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:400;color:var(--text-secondary);">Your calendar awaits</div>
        <p style="font-size:12px;color:var(--text-muted);font-weight:300;max-width:280px;line-height:1.6;">Connect your Google account in Settings to sync your calendar events and stay organized.</p>
        <button class="btn-pink" data-nav="settings" style="margin-top:8px;padding:10px 24px;font-size:12px;">Connect Google Account</button>
      </div>`;
      return;
    }

    // Load FullCalendar (loaded via global script tags)
    try {
      const FC = window.FullCalendar;
      if (!FC) throw new Error('FullCalendar not loaded');

      calendarInstance = new FC.Calendar(el, {
        initialView: currentViewType,
        headerToolbar: false,
        editable: true,
        selectable: true,
        dayMaxEvents: 3,
        height: '100%',
        nowIndicator: true,
        events: fetchEvents,
        dateClick: handleDateClick,
        eventClick: handleEventClick,
        eventDrop: handleEventDrop,
        eventResize: handleEventResize,
        // Mobile-only: paint per-day dot indicators after each event set
        // is laid out, and refresh the selected-day events strip.
        eventsSet: (evts) => {
          if (window.innerWidth > 768) return;
          _renderMobileDots(evts);
          _renderMobileDayStrip(_selectedDate || new Date(), evts);
        }
      });

      calendarInstance.render();
      updateTitle();

      // ── Smooth sidebar-driven calendar resize ──
      // Strategy: continuous rAF loop during the sidebar transition keeps the
      // calendar grid in lockstep with the container width (no mid-transition
      // snap). ResizeObserver is suppressed during this window to avoid
      // dueling updateSize() calls.
      _sidebarEl = document.querySelector('.sidebar');
      let isSidebarAnimating = false;
      let animEndTime = 0;
      let lastUpdateSizeAt = 0;

      // Throttle updateSize() to ~15fps (every 66ms) during the
      // sidebar transition. FullCalendar's updateSize is an expensive
      // full-grid layout recalc; firing it at rAF-native 60fps over
      // the 350ms transition meant ~21 full layouts for one hover —
      // the single biggest contributor to the hover lag. 15fps is
      // still visually smooth for a width animation while cutting the
      // work ~4×. The final `calendarInstance.updateSize()` below
      // guarantees pixel-accurate fit at rest.
      const animateCalendarSize = () => {
        const now = Date.now();
        if (calendarInstance && (now - lastUpdateSizeAt) >= 66) {
          lastUpdateSizeAt = now;
          calendarInstance.updateSize();
        }
        if (now < animEndTime) {
          _animFrameId = requestAnimationFrame(animateCalendarSize);
        } else {
          _animFrameId = null;
          isSidebarAnimating = false;
          calendarInstance?.updateSize();
        }
      };

      const startSidebarAnimation = () => {
        animEndTime = Date.now() + 350;
        isSidebarAnimating = true;
        if (_animFrameId == null) {
          _animFrameId = requestAnimationFrame(animateCalendarSize);
        }
      };

      _onSidebarMouse = startSidebarAnimation;
      if (_sidebarEl) {
        _sidebarEl.addEventListener('mouseenter', _onSidebarMouse);
        _sidebarEl.addEventListener('mouseleave', _onSidebarMouse);
      }

      _onDocSidebarChange = startSidebarAnimation;
      document.addEventListener('sidebar-width-change', _onDocSidebarChange);

      const container = document.querySelector('.calendar-container');
      if (container && window.ResizeObserver) {
        let resizeTimer = null;
        _resizeObserver = new ResizeObserver(() => {
          if (isSidebarAnimating) return;
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => calendarInstance?.updateSize(), 100);
        });
        _resizeObserver.observe(container);
      }
    } catch (err) {
      console.error('FullCalendar load error:', err);
      el.innerHTML = `<div style="padding:60px 40px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;">
        <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:400;color:var(--text-secondary);">Calendar loading error</div>
        <p style="font-size:12px;color:var(--text-muted);font-weight:300;max-width:340px;line-height:1.6;">${err.message}</p>
      </div>`;
    }

    // Toolbar controls
    document.getElementById('cal-prev')?.addEventListener('click', () => {
      calendarInstance?.prev(); updateTitle();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      calendarInstance?.next(); updateTitle();
    });
    document.getElementById('cal-today')?.addEventListener('click', () => {
      calendarInstance?.today(); updateTitle();
    });

    document.querySelectorAll('[data-cal-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cal-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentViewType = btn.dataset.calView;
        calendarInstance?.changeView(currentViewType);
        updateTitle();
      });
    });

    // Modal controls
    document.getElementById('event-cancel')?.addEventListener('click', closeModal);
    document.getElementById('event-save')?.addEventListener('click', saveEvent);
    document.getElementById('event-delete')?.addEventListener('click', deleteEvent);
    document.getElementById('event-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'event-modal') closeModal();
    });

    // Listen for AI tool mutations (create/update/delete) → refetch events live.
    // Without this, an AI-created event while the user is ON the calendar page
    // wouldn't appear until they navigated away and back.
    _attachCalendarChangedListener();

    // Deep link: jump to a specific event's date and open its modal (from search)
    const link = typeof Router !== 'undefined' ? Router.consumeDeepLink('event') : null;
    if (link?.date && calendarInstance) {
      try {
        calendarInstance.gotoDate(new Date(link.date));
        // Switch to day view for focused context
        calendarInstance.changeView('timeGridDay');
        currentViewType = 'timeGridDay';
        document.querySelectorAll('[data-cal-view]').forEach(b => {
          b.classList.toggle('active', b.dataset.calView === 'timeGridDay');
        });
        updateTitle();
        // Try to open the event modal if we have the event details
        if (link.id && link.calendarId) {
          setTimeout(() => _openEventByDeepLink(link), 250);
        }
      } catch (err) {
        console.warn('Deep-link to event failed:', err);
      }
    }
  }

  /** Open the event modal for a deep-linked event by re-fetching its details. */
  async function _openEventByDeepLink(link) {
    if (!window.electronAPI) return;
    try {
      // Fetch events for that day across the relevant calendar to find the match
      const dayStart = new Date(link.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const events = await window.electronAPI.google.listEvents(
        link.calendarId, dayStart.toISOString(), dayEnd.toISOString()
      );
      const target = events.find(e => e.id === link.id);
      if (!target) return;

      editingEventId = target.id;
      editingCalendarId = link.calendarId;
      document.getElementById('event-modal-title').textContent = 'Event Details';
      document.getElementById('event-title').value = target.summary || '';
      const start = target.start?.dateTime || target.start?.date;
      const end = target.end?.dateTime || target.end?.date;
      if (start) document.getElementById('event-start').value = start.slice(0, 16);
      if (end) document.getElementById('event-end').value = end.slice(0, 16);
      document.getElementById('event-description').value = target.description || '';
      document.getElementById('event-delete').style.display = 'inline-block';
      document.getElementById('event-modal').style.display = 'flex';
    } catch (err) {
      console.warn('Could not open deep-linked event:', err);
    }
  }

  function updateTitle() {
    const titleEl = document.getElementById('cal-title');
    if (titleEl && calendarInstance) {
      titleEl.textContent = calendarInstance.view.title;
    }
  }

  async function fetchEvents(info, successCallback, failureCallback) {
    if (!window.electronAPI) { successCallback([]); return; }
    try {
      // Get all calendars the user has, then fetch their events in PARALLEL.
      // Previously this was a serial for-loop awaiting each listEvents call in
      // sequence — with 10 calendars (typical when holidays/school/family are
      // subscribed) that stacked 10× the per-request round-trip latency on
      // every view switch, prev/next click, and drag. Promise.all collapses
      // that to the slowest single request.
      const calendars = await window.electronAPI.google.listCalendars();

      const perCalendarResults = await Promise.all(calendars.map(async (cal) => {
        try {
          const events = await window.electronAPI.google.listEvents(
            cal.id, info.startStr, info.endStr
          );
          const isReadOnly = cal.accessRole === 'reader' || cal.accessRole === 'freeBusyReader';
          const isHoliday = (cal.id || '').includes('#holiday') || (isReadOnly && /holiday/i.test(cal.summary || ''));
          return events.map(e => ({
            id: e.id + '_' + cal.id,
            title: e.summary,
            start: e.start?.dateTime || e.start?.date,
            end: e.end?.dateTime || e.end?.date,
            allDay: e.allDay,
            classNames: isHoliday ? ['fc-event-holiday'] : [],
            backgroundColor: isHoliday ? 'rgba(253,154,108,0.25)' : (cal.backgroundColor || undefined),
            borderColor: 'transparent',
            textColor: isHoliday ? '#fd9a6c' : '#fff',
            extendedProps: {
              description: e.description,
              calendarName: cal.summary,
              calendarId: cal.id,
              realEventId: e.id,
              isHoliday
            }
          }));
        } catch (calErr) {
          console.warn(`Failed to fetch events from ${cal.summary}:`, calErr.message);
          return [];
        }
      }));

      successCallback(perCalendarResults.flat());
    } catch (err) {
      console.error('Failed to fetch events:', err);
      failureCallback(err);
    }
  }

  let editingEventId = null;
  let editingCalendarId = 'primary';

  // ── Mobile-only helpers ─────────────────────────────────────────
  let _selectedDate = null;
  function _isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function _eventsOnDay(allEvents, day) {
    const dayStart = new Date(day); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    return allEvents.filter(e => {
      const s = e.start; if (!s) return false;
      const eStart = new Date(s);
      const eEnd = e.end ? new Date(e.end) : new Date(eStart.getTime() + 3600_000);
      return eStart < dayEnd && eEnd > dayStart;
    });
  }
  function _formatTime(d, allDay) {
    if (allDay) return 'All day';
    const h = d.getHours(); const m = d.getMinutes();
    const am = h < 12; const h12 = ((h + 11) % 12) + 1;
    return `${h12}${m ? ':' + String(m).padStart(2,'0') : ''}${am ? 'a' : 'p'}`;
  }
  function _renderMobileDots(allEvents) {
    document.querySelectorAll('.calendar-container .fc-daygrid-day').forEach(cell => {
      const dateStr = cell.getAttribute('data-date');
      if (!dateStr) return;
      const day = new Date(dateStr + 'T00:00:00');
      const events = _eventsOnDay(allEvents, day);
      let dotsHost = cell.querySelector('.mobile-event-dots');
      if (!dotsHost) {
        dotsHost = document.createElement('div');
        dotsHost.className = 'mobile-event-dots';
        const frame = cell.querySelector('.fc-daygrid-day-frame');
        if (frame) frame.appendChild(dotsHost);
      }
      const visible = Math.min(events.length, 3);
      dotsHost.innerHTML = '';
      for (let i = 0; i < visible; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot' + (events[i].extendedProps?.isHoliday ? ' holiday' : '');
        if (events[i].backgroundColor) dot.style.background = events[i].backgroundColor;
        dotsHost.appendChild(dot);
      }
    });
  }
  function _esc(s) { return String(s || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
  function _renderMobileDayStrip(day, allEvents) {
    const titleEl = document.getElementById('mobile-day-events-title');
    const countEl = document.getElementById('mobile-day-events-count');
    const listEl = document.getElementById('mobile-day-events-list');
    if (!titleEl || !listEl) return;
    const today = new Date();
    const isToday = _isSameDay(day, today);
    titleEl.textContent = isToday
      ? 'Today'
      : day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    const events = _eventsOnDay(allEvents, day)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    if (countEl) {
      countEl.textContent = events.length === 0
        ? day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
        : `${events.length} ${events.length === 1 ? 'event' : 'events'} · ${day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
    }
    if (events.length === 0) {
      listEl.innerHTML = `<div class="mobile-day-events-empty">Nothing scheduled</div>`;
      return;
    }
    listEl.innerHTML = events.map(e => {
      const start = new Date(e.start);
      const time = _formatTime(start, !!e.allDay);
      const accent = e.backgroundColor || 'var(--accent-pink)';
      const loc = e.extendedProps?.location || '';
      return `<div class="mobile-day-event-row" data-event-id="${_esc(e.id)}">
        <div class="mobile-day-event-accent" style="background:${_esc(accent)};"></div>
        <div class="mobile-day-event-time">${_esc(time)}</div>
        <div class="mobile-day-event-body">
          <div class="mobile-day-event-title">${_esc(e.title || '(No title)')}</div>
          ${loc ? `<div class="mobile-day-event-loc">${_esc(loc)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function handleDateClick(info) {
    if (window.innerWidth <= 768) {
      _selectedDate = info.date;
      const all = calendarInstance ? calendarInstance.getEvents() : [];
      _renderMobileDayStrip(_selectedDate, all);
      // Visual: highlight the tapped cell with the today-style ring
      document.querySelectorAll('.calendar-container .fc-daygrid-day.is-mobile-selected')
        .forEach(c => c.classList.remove('is-mobile-selected'));
      info.dayEl?.classList.add('is-mobile-selected');
      return;
    }
    editingEventId = null;
    document.getElementById('event-modal-title').textContent = 'New Event';
    document.getElementById('event-title').value = '';
    document.getElementById('event-start').value = info.dateStr.includes('T')
      ? info.dateStr.slice(0, 16) : info.dateStr + 'T09:00';
    document.getElementById('event-end').value = info.dateStr.includes('T')
      ? info.dateStr.slice(0, 16) : info.dateStr + 'T10:00';
    document.getElementById('event-description').value = '';
    document.getElementById('event-delete').style.display = 'none';
    document.getElementById('event-modal').style.display = 'flex';
  }

  function handleEventClick(info) {
    // Holidays are read-only
    if (info.event.extendedProps?.isHoliday) return;

    editingEventId = info.event.extendedProps?.realEventId || info.event.id;
    editingCalendarId = info.event.extendedProps?.calendarId || 'primary';
    document.getElementById('event-modal-title').textContent = 'Edit Event';
    document.getElementById('event-title').value = info.event.title;
    document.getElementById('event-start').value = info.event.startStr?.slice(0, 16) || '';
    document.getElementById('event-end').value = info.event.endStr?.slice(0, 16) || '';
    document.getElementById('event-description').value = info.event.extendedProps?.description || '';
    document.getElementById('event-delete').style.display = 'inline-block';
    document.getElementById('event-modal').style.display = 'flex';
  }

  async function handleEventDrop(info) {
    if (!window.electronAPI) return;
    // Read the source calendar + real event id from FullCalendar's extended
    // props. Using 'primary' here unconditionally would silently fail for
    // events from a school/family/work calendar (or worse, mutate the wrong
    // event if Google ever returns a same-id collision across calendars).
    const calendarId = info.event.extendedProps?.calendarId || 'primary';
    const realId = info.event.extendedProps?.realEventId || info.event.id;
    try {
      await window.electronAPI.google.updateEvent(calendarId, realId, {
        start: { dateTime: info.event.startStr },
        end: { dateTime: info.event.endStr }
      });
      Toast.show('Event moved', 'success');
    } catch (err) {
      Toast.show('Failed to move event', 'error');
      info.revert();
    }
  }

  async function handleEventResize(info) {
    if (!window.electronAPI) return;
    const calendarId = info.event.extendedProps?.calendarId || 'primary';
    const realId = info.event.extendedProps?.realEventId || info.event.id;
    try {
      await window.electronAPI.google.updateEvent(calendarId, realId, {
        end: { dateTime: info.event.endStr }
      });
      Toast.show('Event updated', 'success');
    } catch (err) {
      Toast.show('Failed to update event', 'error');
      info.revert();
    }
  }

  function closeModal() {
    document.getElementById('event-modal').style.display = 'none';
    editingEventId = null;
  }

  async function saveEvent() {
    if (!window.electronAPI) return;
    const title = document.getElementById('event-title').value.trim();
    const start = document.getElementById('event-start').value;
    const end = document.getElementById('event-end').value;
    const desc = document.getElementById('event-description').value;

    if (!title || !start || !end) {
      Toast.show('Please fill in title, start, and end', 'warning');
      return;
    }

    try {
      if (editingEventId) {
        await window.electronAPI.google.updateEvent('primary', editingEventId, {
          summary: title,
          start: { dateTime: new Date(start).toISOString() },
          end: { dateTime: new Date(end).toISOString() },
          description: desc
        });
        Toast.show('Event updated', 'success');
      } else {
        await window.electronAPI.google.createEvent('primary', {
          summary: title,
          start: { dateTime: new Date(start).toISOString() },
          end: { dateTime: new Date(end).toISOString() },
          description: desc
        });
        Toast.show('Event created', 'success');
      }
      closeModal();
      calendarInstance?.refetchEvents();
    } catch (err) {
      Toast.show('Failed to save event', 'error');
    }
  }

  async function deleteEvent() {
    if (!window.electronAPI || !editingEventId) return;
    try {
      await window.electronAPI.google.deleteEvent('primary', editingEventId);
      Toast.show('Event deleted', 'success');
      closeModal();
      calendarInstance?.refetchEvents();
    } catch (err) {
      Toast.show('Failed to delete event', 'error');
    }
  }

  // Subscribe to the calendar-changed IPC broadcast fired by the AI calendar
  // tools. Any create/update/delete triggers a FullCalendar refetch — so
  // events the AI makes appear live even if the user is on the calendar page
  // when Bloom runs the tool.
  let _calendarChangedCleanup = null;
  function _attachCalendarChangedListener() {
    if (_calendarChangedCleanup) _calendarChangedCleanup();
    if (!window.electronAPI?.google?.onCalendarChanged) return;
    _calendarChangedCleanup = window.electronAPI.google.onCalendarChanged((payload) => {
      try {
        calendarInstance?.refetchEvents();
      } catch {}
      if (typeof Toast !== 'undefined' && payload?.summary) {
        const verb = payload.type === 'created' ? 'added' : payload.type === 'deleted' ? 'removed' : 'updated';
        Toast.show(`Event ${verb}: ${payload.summary}`, 'info', 2200);
      }
    });
  }

  function destroy() {
    if (_calendarChangedCleanup) { _calendarChangedCleanup(); _calendarChangedCleanup = null; }
    // Tear down everything init() attached. Without this, each calendar
    // visit leaked a pair of sidebar listeners + a ResizeObserver + a
    // document-level listener — compounding on every navigation.
    if (_sidebarEl && _onSidebarMouse) {
      _sidebarEl.removeEventListener('mouseenter', _onSidebarMouse);
      _sidebarEl.removeEventListener('mouseleave', _onSidebarMouse);
    }
    if (_onDocSidebarChange) {
      document.removeEventListener('sidebar-width-change', _onDocSidebarChange);
    }
    if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
    if (_animFrameId != null) { cancelAnimationFrame(_animFrameId); _animFrameId = null; }
    _sidebarEl = null;
    _onSidebarMouse = null;
    _onDocSidebarChange = null;
    calendarInstance?.destroy();
    calendarInstance = null;
  }

  return { render, init, destroy };
})();
