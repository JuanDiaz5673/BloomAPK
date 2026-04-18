// ─── Mobile Google Calendar service ───────────────────────────────
//
// Same return shapes as the desktop google-calendar.js so view code
// (calendar.js, home.js) keeps working unchanged.

(() => {
  const BASE = 'https://www.googleapis.com/calendar/v3';
  function _api() { return window._bloomGoogleApi; }

  // Match the desktop sanitizer's intent (whitelist fields, no HTML
  // injection). We're stricter here — fewer fields are exposed via the
  // mobile UI so far.
  function _clamp(s, max) { return typeof s === 'string' ? s.slice(0, max) : ''; }
  function _sanitizeEvent(event = {}) {
    const out = {};
    if (event.summary) out.summary = _clamp(event.summary, 1024);
    if (event.description) out.description = _clamp(event.description, 8192);
    if (event.location) out.location = _clamp(event.location, 1024);
    if (event.start) out.start = event.start;
    if (event.end) out.end = event.end;
    if (Array.isArray(event.attendees)) {
      out.attendees = event.attendees
        .filter(a => a && typeof a.email === 'string')
        .slice(0, 50)
        .map(a => ({ email: _clamp(a.email, 256) }));
    }
    return out;
  }

  async function listCalendars() {
    const data = await _api().authedFetch(`${BASE}/users/me/calendarList`);
    return (data.items || []).map(cal => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary || false,
      backgroundColor: cal.backgroundColor,
      accessRole: cal.accessRole,
    }));
  }

  async function listEvents(calendarId = 'primary', timeMin, timeMax) {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (timeMin) params.set('timeMin', timeMin);
    if (timeMax) params.set('timeMax', timeMax);
    const data = await _api().authedFetch(
      `${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    );
    return (data.items || []).map(event => ({
      id: event.id,
      summary: event.summary || '(No title)',
      description: event.description || '',
      location: event.location || '',
      start: event.start,
      end: event.end,
      status: event.status,
      htmlLink: event.htmlLink,
      attendees: event.attendees || [],
      colorId: event.colorId,
      allDay: !!event.start?.date,
    }));
  }

  async function createEvent(calendarId = 'primary', event) {
    const body = _sanitizeEvent(event);
    const data = await _api().authedFetch(
      `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    return { id: data.id, summary: data.summary, start: data.start, end: data.end, htmlLink: data.htmlLink };
  }

  async function updateEvent(calendarId = 'primary', eventId, updates) {
    const body = _sanitizeEvent(updates);
    const data = await _api().authedFetch(
      `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    );
    return { id: data.id, summary: data.summary, start: data.start, end: data.end };
  }

  async function deleteEvent(calendarId = 'primary', eventId) {
    await _api().authedFetch(
      `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' }
    );
    return { success: true };
  }

  async function getUpcomingEvents(days = 7) {
    const now = new Date();
    const future = new Date(now.getTime() + days * 86400_000);
    return listEvents('primary', now.toISOString(), future.toISOString());
  }

  window._bloomCalendar = {
    listCalendars, listEvents, createEvent, updateEvent, deleteEvent, getUpcomingEvents,
  };
})();
