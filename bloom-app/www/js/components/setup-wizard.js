// ─── First-Run Setup Wizard ───
// Glass-morphism modal that walks new users through Google sign-in,
// AI provider setup, and theme picking. Triggered when no
// `hasCompletedSetup` flag exists in store. Each step is skippable.
const SetupWizard = (() => {
  let overlay = null;
  let currentStep = 0;
  const totalSteps = 3;

  // Canonical 5-char HTML escape — handles &, <, >, ", '. Use this for ALL
  // interpolation of external data (Google profile name, theme paths, etc.)
  // into HTML/attribute contexts. textContent → innerHTML round-tripping
  // does NOT escape quotes and is unsafe for attribute interpolation.
  function _escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function shouldShow() {
    if (!window.electronAPI) return false;
    try {
      const done = await window.electronAPI.store.get('hasCompletedSetup');
      return !done;
    } catch {
      return false;
    }
  }

  async function markComplete() {
    try {
      await window.electronAPI.store.set('hasCompletedSetup', true);
    } catch {}
  }

  function close() {
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay?.remove();
        overlay = null;
      }, 300);
    }
  }

  async function show() {
    if (overlay) return; // Already open
    currentStep = 0;
    overlay = document.createElement('div');
    overlay.className = 'setup-wizard-overlay';
    overlay.innerHTML = `
      <div class="setup-wizard-modal glass-card">
        <div class="setup-wizard-progress">
          <div class="setup-wizard-progress-bar" id="setup-progress-bar"></div>
        </div>
        <div class="setup-wizard-content" id="setup-wizard-content"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    await renderStep(0);
  }

  async function renderStep(step) {
    currentStep = step;
    const content = document.getElementById('setup-wizard-content');
    const progressBar = document.getElementById('setup-progress-bar');
    if (!content || !progressBar) return;

    progressBar.style.width = `${((step + 1) / totalSteps) * 100}%`;

    if (step === 0) await renderWelcomeStep(content);
    else if (step === 1) await renderAIStep(content);
    else if (step === 2) await renderThemeStep(content);
  }

  async function renderWelcomeStep(content) {
    let isConnected = false;
    let profileName = '';
    try {
      const status = await window.electronAPI.google.getStatus();
      isConnected = status.authenticated;
      if (isConnected) {
        const profile = await window.electronAPI.google.getProfile();
        profileName = profile?.name || '';
      }
    } catch {}

    content.innerHTML = `
      <div class="setup-step">
        <div class="setup-step-icon">
          <img src="assets/images/bloom-avatar.png" alt="" style="width:80px;height:80px;border-radius:50%;animation:float 3s ease-in-out infinite;filter:drop-shadow(0 8px 24px rgba(var(--accent-primary-rgb),0.3));">
        </div>
        <h1 class="setup-step-title">Welcome to AllDash</h1>
        <p class="setup-step-desc">Your personal productivity dashboard with calendar, notes, and AI assistant — all powered by your own accounts.</p>

        <div class="setup-card">
          <div class="setup-card-header">
            <div class="setup-card-icon" style="background:rgba(255,107,157,0.1);">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent-pink)" stroke-width="1.8" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div>
              <div class="setup-card-title">Google Account</div>
              <div class="setup-card-sub">Calendar, Drive, and Notes sync</div>
            </div>
          </div>
          ${isConnected
            ? `<div class="setup-card-status connected">✓ Connected as ${_escape(profileName || 'Google user')}</div>`
            : `<button class="btn-pink" id="setup-google-btn" style="width:100%;padding:10px;font-size:12px;">Connect Google Account</button>
               <div class="setup-card-hint">Required for calendar events and cloud-synced notes. We'll never see or store your data — it stays in your Google account.</div>`
          }
        </div>

        <div class="setup-step-actions">
          <button class="setup-btn-skip" id="setup-skip-btn">Skip for now</button>
          <button class="btn-pink" id="setup-next-btn" style="padding:10px 24px;font-size:12px;">Next →</button>
        </div>
      </div>`;

    document.getElementById('setup-google-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('setup-google-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Opening Google sign-in...'; }
      try {
        const result = await window.electronAPI.google.login();
        if (result.success) {
          Toast.show('Google account connected!', 'success');
          await renderStep(0); // Re-render to show connected state
          Header.updateWithProfile?.();
        } else {
          Toast.show(result.error || 'Sign-in cancelled', 'warning');
          if (btn) { btn.disabled = false; btn.textContent = 'Connect Google Account'; }
        }
      } catch (err) {
        Toast.show('Sign-in failed', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Connect Google Account'; }
      }
    });

    document.getElementById('setup-next-btn')?.addEventListener('click', () => renderStep(1));
    document.getElementById('setup-skip-btn')?.addEventListener('click', async () => {
      await markComplete();
      close();
    });
  }

  async function renderAIStep(content) {
    let providerStatus;
    try {
      providerStatus = await window.electronAPI.ai.getProviderStatus();
    } catch {
      providerStatus = { active: 'gemini', providers: { claude: { hasKey: false }, gemini: { hasKey: false } } };
    }

    const claudeReady = providerStatus.providers.claude.hasKey;
    const geminiReady = providerStatus.providers.gemini.hasKey;
    const anyReady = claudeReady || geminiReady;

    content.innerHTML = `
      <div class="setup-step">
        <div class="setup-step-icon">
          <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,var(--accent-pink),var(--accent-rose));display:flex;align-items:center;justify-content:center;box-shadow:0 8px 32px rgba(var(--accent-primary-rgb),0.35);">
            <svg viewBox="0 0 24 24" width="32" height="32" stroke="white" stroke-width="1.8" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
        </div>
        <h1 class="setup-step-title">Pick your AI</h1>
        <p class="setup-step-desc">Bloom is your AI assistant — pick a provider and add your key. You can change this later in Settings.</p>

        <div class="setup-card setup-card-clickable ${geminiReady ? 'connected' : ''}" data-provider="gemini">
          <div class="setup-card-header">
            <div class="setup-card-icon" style="background:rgba(253,154,108,0.1);">
              <div style="width:8px;height:8px;border-radius:50%;background:var(--accent-warm);box-shadow:0 0 8px var(--accent-warm);"></div>
            </div>
            <div style="flex:1;">
              <div class="setup-card-title">Gemini 2.5 Flash <span style="font-size:10px;color:var(--accent-warm);margin-left:6px;background:rgba(253,154,108,0.15);padding:2px 8px;border-radius:8px;">FREE</span></div>
              <div class="setup-card-sub">Google · 1,500 requests/day · no credit card</div>
            </div>
            ${geminiReady ? '<div style="color:#6fdb8b;font-size:18px;">✓</div>' : ''}
          </div>
          <input type="password" class="settings-input setup-key-input" id="setup-gemini-key" placeholder="${geminiReady ? 'Key already set — paste a new one to replace' : 'Paste Gemini API key (starts with AIza...)'}" style="width:100%;margin-top:10px;padding:8px 12px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
            <a href="#" id="setup-get-gemini" style="font-size:11px;color:var(--accent-pink);text-decoration:none;">Get a free key →</a>
            <button class="btn-sm" id="setup-save-gemini" style="padding:5px 14px;font-size:11px;">Save</button>
          </div>
        </div>

        <div class="setup-card setup-card-clickable ${claudeReady ? 'connected' : ''}" data-provider="claude">
          <div class="setup-card-header">
            <div class="setup-card-icon" style="background:rgba(232,67,147,0.1);">
              <div style="width:8px;height:8px;border-radius:50%;background:var(--accent-rose);box-shadow:0 0 8px var(--accent-rose);"></div>
            </div>
            <div style="flex:1;">
              <div class="setup-card-title">Claude Haiku 4.5 <span style="font-size:10px;color:var(--text-muted);margin-left:6px;background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:8px;">PAID</span></div>
              <div class="setup-card-sub">Anthropic · highest quality · usage-based pricing</div>
            </div>
            ${claudeReady ? '<div style="color:#6fdb8b;font-size:18px;">✓</div>' : ''}
          </div>
          <input type="password" class="settings-input setup-key-input" id="setup-claude-key" placeholder="${claudeReady ? 'Key already set — paste a new one to replace' : 'Paste Claude API key (starts with sk-ant-...)'}" style="width:100%;margin-top:10px;padding:8px 12px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
            <a href="#" id="setup-get-claude" style="font-size:11px;color:var(--accent-pink);text-decoration:none;">Get a key →</a>
            <button class="btn-sm" id="setup-save-claude" style="padding:5px 14px;font-size:11px;">Save</button>
          </div>
        </div>

        <div class="setup-step-actions">
          <button class="setup-btn-skip" id="setup-back-btn">← Back</button>
          <button class="${anyReady ? 'btn-pink' : 'setup-btn-skip'}" id="setup-next-btn" style="padding:10px 24px;font-size:12px;">${anyReady ? 'Next →' : 'Skip for now'}</button>
        </div>
      </div>`;

    document.getElementById('setup-get-gemini')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI?.app?.openExternal?.('https://aistudio.google.com/apikey');
    });
    document.getElementById('setup-get-claude')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI?.app?.openExternal?.('https://console.anthropic.com/settings/keys');
    });

    document.getElementById('setup-save-gemini')?.addEventListener('click', async () => {
      const input = document.getElementById('setup-gemini-key');
      const key = input?.value.trim();
      if (!key) { Toast.show('Paste a key first', 'warning'); return; }
      try {
        await window.electronAPI.gemini.setApiKey(key);
        await window.electronAPI.ai.setProvider('gemini');
        Toast.show('Gemini ready to go!', 'success');
      } catch { Toast.show('Failed to save key', 'error'); }
      finally {
        // Always clear the input — never leave the plaintext key in the DOM
        // even on error. Devtools open in dev would otherwise expose it.
        if (input) input.value = '';
      }
      await renderStep(1);
    });

    document.getElementById('setup-save-claude')?.addEventListener('click', async () => {
      const input = document.getElementById('setup-claude-key');
      const key = input?.value.trim();
      if (!key) { Toast.show('Paste a key first', 'warning'); return; }
      try {
        await window.electronAPI.claude.setApiKey(key);
        await window.electronAPI.ai.setProvider('claude');
        Toast.show('Claude ready to go!', 'success');
      } catch { Toast.show('Failed to save key', 'error'); }
      finally {
        if (input) input.value = '';
      }
      await renderStep(1);
    });

    document.getElementById('setup-back-btn')?.addEventListener('click', () => renderStep(0));
    document.getElementById('setup-next-btn')?.addEventListener('click', () => renderStep(2));
  }

  async function renderThemeStep(content) {
    content.innerHTML = `
      <div class="setup-step">
        <div class="setup-step-icon">
          <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,var(--accent-pink),var(--accent-warm));display:flex;align-items:center;justify-content:center;box-shadow:0 8px 32px rgba(var(--accent-primary-rgb),0.35);">
            <svg viewBox="0 0 24 24" width="32" height="32" stroke="white" stroke-width="1.5" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
        </div>
        <h1 class="setup-step-title">Pick your vibe</h1>
        <p class="setup-step-desc">Choose a theme to personalize your dashboard. The whole color palette adapts to whatever you pick. Change anytime in Settings.</p>

        <div class="setup-theme-grid" id="setup-theme-grid">
          <div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-muted);font-size:11px;">Loading themes...</div>
        </div>

        <div class="setup-step-actions">
          <button class="setup-btn-skip" id="setup-back-btn">← Back</button>
          <button class="btn-pink" id="setup-finish-btn" style="padding:10px 28px;font-size:12px;">Finish setup ✨</button>
        </div>
      </div>`;

    // Load preset thumbnails
    try {
      const presets = ['flowers.png', 'sunset.png', 'ocean.png', 'forest.png', 'aurora.png', 'night.png'];
      const grid = document.getElementById('setup-theme-grid');
      const thumbnailHTMLs = await Promise.all(presets.map(async (preset) => {
        try {
          const path = await window.electronAPI.theme.getPresetPath(preset);
          // Both `preset` (literal from the array) and `path` (from main process)
          // are escaped defensively — if either gets refactored to come from
          // user input later, this won't suddenly become an XSS vector.
          return `<div class="setup-theme-item" data-preset="${_escape(preset)}" style="background-image:url('file:///${_escape(path).replace(/'/g, '%27')}');"></div>`;
        } catch {
          return '';
        }
      }));
      if (grid) {
        grid.innerHTML = thumbnailHTMLs.filter(Boolean).join('') || '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:11px;">No presets found</div>';

        // Wire up clicks
        grid.querySelectorAll('.setup-theme-item').forEach(item => {
          item.addEventListener('click', async () => {
            grid.querySelectorAll('.setup-theme-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            try {
              await ThemeEngine.applyPreset(item.dataset.preset);
            } catch {}
          });
        });
      }
    } catch (err) {
      console.error('Failed to load theme presets:', err);
    }

    document.getElementById('setup-back-btn')?.addEventListener('click', () => renderStep(1));
    document.getElementById('setup-finish-btn')?.addEventListener('click', async () => {
      await markComplete();
      Toast.show('Welcome aboard! 🌸', 'success');
      close();
    });
  }

  return { show, shouldShow, markComplete };
})();
