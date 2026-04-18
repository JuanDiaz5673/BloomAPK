// ─── Stats View ───
const StatsView = (() => {
  function render() {
    return `
    <div class="settings-view" style="max-width:720px;">
      <!-- Weekly Activity Chart -->
      <div class="glass-card settings-section" style="animation:fadeSlideUp 0.5s ease 0.05s both;">
        <div class="stats-header">
          <h3 style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:400;">Weekly Activity</h3>
          <span class="trend" id="stats-trend">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>
            +0%
          </span>
        </div>
        <div class="stat-bars" id="stats-bars" style="height:140px;padding-top:30px;">
          <div class="stat-bar" data-value="0" style="height:10%;"></div>
          <div class="stat-bar" data-value="0" style="height:10%;"></div>
          <div class="stat-bar" data-value="0" style="height:10%;"></div>
          <div class="stat-bar" data-value="0" style="height:10%;"></div>
          <div class="stat-bar" data-value="0" style="height:10%;"></div>
          <div class="stat-bar" data-value="0" style="height:10%;"></div>
          <div class="stat-bar" data-value="0" style="height:10%;"></div>
        </div>
        <div class="stat-labels" id="stats-labels">
          <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
        </div>
      </div>

      <!-- Feature Usage as visual cards -->
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
        <div class="glass-card" style="padding:18px;text-align:center;animation:fadeSlideUp 0.5s ease 0.15s both;">
          <div style="width:36px;height:36px;border-radius:12px;background:rgba(255,107,157,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--accent-pink)" stroke-width="1.8" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="stat-num" id="stat-cal-views" style="font-size:24px;">0</div>
          <div style="font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Calendar Views</div>
        </div>
        <div class="glass-card" style="padding:18px;text-align:center;animation:fadeSlideUp 0.5s ease 0.2s both;">
          <div style="width:36px;height:36px;border-radius:12px;background:rgba(253,154,108,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--accent-warm)" stroke-width="1.8" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div class="stat-num" id="stat-note-edits" style="font-size:24px;">0</div>
          <div style="font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Notes Edited</div>
        </div>
        <div class="glass-card" style="padding:18px;text-align:center;animation:fadeSlideUp 0.5s ease 0.25s both;">
          <div style="width:36px;height:36px;border-radius:12px;background:rgba(232,67,147,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--accent-rose)" stroke-width="1.8" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="stat-num" id="stat-bloom-chats" style="font-size:24px;">0</div>
          <div style="font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Bloom Chats</div>
        </div>
        <div class="glass-card" style="padding:18px;text-align:center;animation:fadeSlideUp 0.5s ease 0.3s both;">
          <div style="width:36px;height:36px;border-radius:12px;background:rgba(250,177,196,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--accent-blush)" stroke-width="1.8" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="stat-num" id="stat-files-opened" style="font-size:24px;">0</div>
          <div style="font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Files Opened</div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="glass-card settings-section" style="animation:fadeSlideUp 0.5s ease 0.35s both;">
        <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;">Recent Activity</h3>
        <div class="activity-list" id="stats-activity-list">
          <div style="text-align:center;padding:24px;display:flex;flex-direction:column;align-items:center;gap:10px;">
            <svg viewBox="0 0 24 24" width="40" height="40" stroke="var(--accent-blush)" stroke-width="1" fill="none" style="opacity:0.3;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <div style="font-size:12px;color:var(--text-muted);font-weight:300;">Start using Bloom to see your activity here</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  async function init() {
    if (!window.electronAPI) return;

    try {
      // Load daily usage for bars
      const daily = await window.electronAPI.analytics.getDailyUsage(7);
      const bars = document.querySelectorAll('#stats-bars .stat-bar');
      const labels = document.getElementById('stats-labels');
      const maxCount = Math.max(1, ...daily.map(d => d.count));

      daily.forEach((d, i) => {
        if (bars[i]) {
          const pct = Math.max(5, (d.count / maxCount) * 100);
          bars[i].style.height = pct + '%';
          bars[i].setAttribute('data-value', d.count + ' actions');
        }
      });

      if (labels) {
        labels.innerHTML = daily.map(d => `<span>${d.day}</span>`).join('');
      }

      // Load feature usage stats
      const stats = await window.electronAPI.analytics.getStats('week');
      if (stats.events) {
        document.getElementById('stat-cal-views').textContent = stats.events['calendar_view'] || 0;
        document.getElementById('stat-note-edits').textContent = stats.events['note_edit'] || 0;
        document.getElementById('stat-bloom-chats').textContent = stats.events['bloom_chat'] || 0;
        document.getElementById('stat-files-opened').textContent = stats.events['file_open'] || 0;
      }

      // Load recent activity
      const activity = await window.electronAPI.analytics.getStats('week');
      if (activity.total > 0) {
        document.getElementById('stats-trend').innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>
          ${activity.total} actions`;
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }

    // Animate bars
    setTimeout(() => {
      document.querySelectorAll('#stats-bars .stat-bar').forEach(bar => {
        bar.style.transition = 'height 0.8s cubic-bezier(0.34,1.56,0.64,1)';
      });
    }, 100);
  }

  function destroy() {}

  return { render, init, destroy };
})();
