// ─── Pomodoro local-notifications wrapper ──────────────────────────
//
// Thin helper around @capacitor/local-notifications for the Study
// view. Schedules a notification for the END of the current interval
// (focus / short break / long break) so the user hears the timer even
// if they switched apps or turned off the screen.
//
// Why this is its own file:
// - The Study view runs its own client-side timer (see
//   views/study.js). We don't touch that loop — we just schedule a
//   system notification to coincide with the intended end time. If
//   the user cancels or restarts the timer, we cancel + reschedule.
// - POST_NOTIFICATIONS is a runtime permission on Android 13+. Without
//   it, the schedule call silently fails. First use triggers the
//   system prompt via `requestPermissions()`.
//
// API (exposed as window._bloomPomo):
//   ensurePermission()        → true if granted (prompts user once)
//   scheduleEnd(kind, seconds, title) → id of scheduled notification
//   cancel(id)
//   cancelAll()

(() => {
  const BASE_ID = 40000; // arbitrary namespace
  let _nextId = BASE_ID;
  let _permissionState = null; // null = unasked, 'granted' | 'denied'

  function _plugin() {
    return window.Capacitor?.Plugins?.LocalNotifications;
  }

  // Tracks whether we've already shown the user a "denied" toast this
  // session — we only want to nag them once per run, not every time
  // they start a pomodoro.
  let _deniedToasted = false;

  async function ensurePermission({ silent = false } = {}) {
    const p = _plugin();
    if (!p) return false;
    if (_permissionState === 'granted') return true;
    try {
      const check = await p.checkPermissions();
      if (check?.display === 'granted') {
        _permissionState = 'granted';
        return true;
      }
      // Android 13+ (API 33+) added the POST_NOTIFICATIONS runtime
      // permission; below that, requestPermissions resolves 'granted'
      // immediately. Either way this is the single call site.
      const req = await p.requestPermissions();
      _permissionState = req?.display === 'granted' ? 'granted' : 'denied';
      if (_permissionState !== 'granted' && !silent && !_deniedToasted) {
        _deniedToasted = true;
        if (window.Toast?.show) {
          window.Toast.show(
            'Notifications blocked. Enable them in Settings → Apps → Bloom → Notifications to get Pomodoro alerts.',
            'warning',
            6000
          );
        }
      }
      return _permissionState === 'granted';
    } catch (err) {
      console.warn('[pomo-notify] Permission request failed:', err);
      return false;
    }
  }

  // Proactive first-run prompt. Called from native-integration.init so
  // the user sees the Android 13+ system dialog when they open the app,
  // not the first time they try to start a pomodoro and silently get
  // nothing. Safe to call on older Android — just no-ops to granted.
  async function primePermission() {
    const p = _plugin();
    if (!p) return false;
    try {
      const check = await p.checkPermissions();
      // If the user already made a decision (granted OR denied), don't
      // re-prompt — the OS caches that and re-requests are rejected
      // silently after the second denial anyway.
      if (check?.display === 'granted' || check?.display === 'denied') {
        _permissionState = check.display;
        return _permissionState === 'granted';
      }
      return await ensurePermission({ silent: true });
    } catch { return false; }
  }

  // kind: 'focus' | 'short-break' | 'long-break'
  // seconds: how many seconds from NOW the notification should fire
  async function scheduleEnd(kind, seconds, titleOverride) {
    const p = _plugin();
    if (!p) return null;
    const ok = await ensurePermission();
    if (!ok) return null;

    const id = _nextId++;
    const at = new Date(Date.now() + Math.max(1, seconds) * 1000);

    const { title, body } = _textFor(kind, titleOverride);

    try {
      await p.schedule({
        notifications: [{
          id, title, body,
          schedule: { at },
          smallIcon: 'ic_stat_icon_config_sample', // fallback; any in res/
          channelId: 'bloom-pomodoro',
          extra: { kind },
        }],
      });
      return id;
    } catch (err) {
      console.warn('[pomo-notify] Schedule failed:', err);
      return null;
    }
  }

  function _textFor(kind, override) {
    if (kind === 'focus') {
      return {
        title: override || 'Focus session done',
        body: 'Time for a breather — tap to log your cycle.',
      };
    }
    if (kind === 'short-break') {
      return { title: 'Break over', body: 'Back to it — another focus cycle awaits.' };
    }
    if (kind === 'long-break') {
      return { title: 'Long break over', body: 'Ready for the next cycle?' };
    }
    return { title: override || 'Timer done', body: '' };
  }

  async function cancel(id) {
    const p = _plugin();
    if (!p || id == null) return;
    try { await p.cancel({ notifications: [{ id }] }); } catch { /* ignore */ }
  }

  async function cancelAll() {
    const p = _plugin();
    if (!p) return;
    try {
      const pending = await p.getPending();
      const ours = (pending?.notifications || []).filter(n => n.id >= BASE_ID && n.id < BASE_ID + 10000);
      if (ours.length) await p.cancel({ notifications: ours.map(n => ({ id: n.id })) });
    } catch { /* ignore */ }
  }

  window._bloomPomo = { ensurePermission, primePermission, scheduleEnd, cancel, cancelAll };
})();
