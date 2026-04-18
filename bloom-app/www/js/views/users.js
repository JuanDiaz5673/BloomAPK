// ─── Users View ───
const UsersView = (() => {
  function render() {
    return `
    <div class="users-view">
      <!-- Profile Hero — full width -->
      <div class="glass-card users-profile-hero" style="text-align:center;padding:40px 32px 32px;position:relative;overflow:hidden;animation:fadeSlideUp 0.5s ease 0.05s both;">
        <div style="position:absolute;top:0;left:0;right:0;height:100px;background:linear-gradient(180deg,rgba(var(--accent-primary-rgb),0.1) 0%,transparent 100%);"></div>
        <div style="position:relative;display:flex;align-items:center;gap:20px;justify-content:center;">
          <div class="avatar" style="width:72px;height:72px;font-size:28px;border-radius:20px;box-shadow:0 8px 32px rgba(var(--accent-primary-rgb),0.35);flex-shrink:0;" id="user-avatar"><svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
          <div style="text-align:left;">
            <div style="font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:400;background:linear-gradient(135deg,#fff 30%,var(--accent-blush));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;" id="user-name">Your Profile</div>
            <div style="font-size:12px;color:var(--text-muted);font-weight:300;letter-spacing:0.3px;margin-top:2px;" id="user-email">Connect Google account to see profile</div>
          </div>
        </div>
      </div>

      <!-- Two column layout -->
      <div class="users-grid">
        <!-- Connected Services -->
        <div class="glass-card" style="padding:20px;animation:fadeSlideUp 0.5s ease 0.15s both;">
          <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;margin-bottom:16px;">Connected Services</h3>

          <div class="user-service-item">
            <div class="user-service-icon" style="background:rgba(255,107,157,0.1);">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--accent-pink)" stroke-width="1.8" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:400;">Google Calendar</div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:300;margin-top:1px;" id="google-cal-status">Not connected</div>
            </div>
            <div class="ai-status-dot" id="google-cal-dot" style="width:8px;height:8px;background:#ff6b6b;box-shadow:0 0 8px rgba(255,107,107,0.5);flex-shrink:0;"></div>
          </div>

          <div class="user-service-item">
            <div class="user-service-icon" style="background:rgba(253,154,108,0.1);">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--accent-warm)" stroke-width="1.8" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:400;">Google Drive</div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:300;margin-top:1px;" id="google-drive-status">Not connected</div>
            </div>
            <div class="ai-status-dot" id="google-drive-dot" style="width:8px;height:8px;background:#ff6b6b;box-shadow:0 0 8px rgba(255,107,107,0.5);flex-shrink:0;"></div>
          </div>

          <div class="user-service-item">
            <div class="user-service-icon" style="background:rgba(232,67,147,0.1);">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--accent-rose)" stroke-width="1.8" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:400;">Bloom AI</div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:300;margin-top:1px;" id="claude-status">Not configured</div>
            </div>
            <div class="ai-status-dot" id="claude-dot" style="width:8px;height:8px;background:#ff6b6b;box-shadow:0 0 8px rgba(255,107,107,0.5);flex-shrink:0;"></div>
          </div>
        </div>

        <!-- Quick Stats -->
        <div class="glass-card" style="padding:20px;animation:fadeSlideUp 0.5s ease 0.2s both;">
          <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;margin-bottom:16px;">Quick Stats</h3>
          <div class="users-stats-grid">
            <div class="users-stat-card">
              <div class="users-stat-icon" style="background:rgba(255,107,157,0.1);">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent-pink)" stroke-width="1.8" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </div>
              <div class="stat-num" id="user-notes-count" style="font-size:28px;">0</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Notes</div>
            </div>
            <div class="users-stat-card">
              <div class="users-stat-icon" style="background:rgba(253,154,108,0.1);">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent-warm)" stroke-width="1.8" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div class="stat-num" id="user-events-count" style="font-size:28px;">0</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Events</div>
            </div>
            <div class="users-stat-card">
              <div class="users-stat-icon" style="background:rgba(232,67,147,0.1);">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent-rose)" stroke-width="1.8" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <div class="stat-num" id="user-chats-count" style="font-size:28px;">0</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Chats</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  async function init() {
    if (!window.electronAPI) return;

    try {
      const status = await window.electronAPI.google.getStatus();
      if (status.authenticated) {
        const profile = await window.electronAPI.google.getProfile();
        if (profile) {
          document.getElementById('user-name').textContent = profile.name || 'User';
          document.getElementById('user-email').textContent = profile.email || '';
          const avatar = document.getElementById('user-avatar');
          if (avatar && profile.picture && /^https:\/\//i.test(profile.picture)) {
            // DOM construction (not innerHTML) — profile.picture comes from
            // Google and a compromised account could supply a URL with `"` to
            // break out of the src attribute.
            while (avatar.firstChild) avatar.removeChild(avatar.firstChild);
            const img = document.createElement('img');
            img.src = profile.picture;
            img.alt = '';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = 'inherit';
            avatar.appendChild(img);
          } else if (avatar && profile.name) {
            avatar.textContent = profile.name.charAt(0).toUpperCase();
          }
        }

        // Google status
        setStatus('google-cal-status', 'google-cal-dot', 'Connected', true);
        setStatus('google-drive-status', 'google-drive-dot', 'Connected', true);

        // Counts
        try {
          const notes = await window.electronAPI.notes.list();
          document.getElementById('user-notes-count').textContent = notes.length;
        } catch {}

        try {
          const now = new Date();
          const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          const events = await window.electronAPI.google.listEvents('primary', now.toISOString(), weekEnd.toISOString());
          document.getElementById('user-events-count').textContent = events.length;
        } catch {}
      }

      const hasAny = await window.electronAPI.ai.hasAnyProvider();
      if (hasAny) setStatus('claude-status', 'claude-dot', 'Configured', true);

      const convos = await window.electronAPI.ai.listConversations();
      document.getElementById('user-chats-count').textContent = convos.length;
    } catch {}
  }

  function setStatus(textId, dotId, text, connected) {
    const textEl = document.getElementById(textId);
    const dotEl = document.getElementById(dotId);
    if (textEl) textEl.textContent = text;
    if (dotEl) {
      dotEl.style.background = connected ? '#6fdb8b' : '#ff6b6b';
      dotEl.style.boxShadow = connected ? '0 0 8px rgba(111,219,139,0.5)' : '0 0 8px rgba(255,107,107,0.5)';
    }
  }

  function destroy() {}

  return { render, init, destroy };
})();
