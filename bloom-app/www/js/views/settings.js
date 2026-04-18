// ─── Settings View ───
const SettingsView = (() => {
  // Theme thumbnail cache — module-level Map<sourcePath, dataURL>. We
  // downsample the full-res background images (often 1920×1080+, up to
  // 2.4 MB each) to ~220×140 JPEG data URLs ONCE per source path, then
  // reuse the tiny cached version forever. Without this, every scroll
  // of the theme grid + every sidebar expand/collapse was triggering
  // browser re-decodes of full-res PNGs, which was the actual cause of
  // the churny lag the user reported on custom themes. ~120KB decoded
  // per thumb × ~20 thumbs = ~2.4MB total in memory; fine. Never
  // evicted during session — the set is small and the source paths are
  // stable.
  const _thumbCache = new Map();

  // Small inline canvas resize. `img` loads the full-res source once,
  // we crop-to-cover into a small canvas, encode as JPEG, and resolve
  // with the data URL. JPEG is ~5× smaller than PNG at this size and
  // the quality loss is invisible for a 220×140 tile. Errors resolve
  // to null so callers can fall back to the original path.
  function _getResizedThumb(srcPath, targetW = 220, targetH = 140) {
    if (_thumbCache.has(srcPath)) return Promise.resolve(_thumbCache.get(srcPath));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          // Crop-to-cover math: sample the centered portion of the
          // source whose aspect ratio matches the target, then draw
          // stretched to fill. Matches CSS `object-fit: cover`.
          const srcRatio = img.width / img.height;
          const dstRatio = targetW / targetH;
          let sx, sy, sw, sh;
          if (srcRatio > dstRatio) {
            sh = img.height;
            sw = sh * dstRatio;
            sx = (img.width - sw) / 2;
            sy = 0;
          } else {
            sw = img.width;
            sh = sw / dstRatio;
            sx = 0;
            sy = (img.height - sh) / 2;
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
          const dataURL = canvas.toDataURL('image/jpeg', 0.85);
          _thumbCache.set(srcPath, dataURL);
          resolve(dataURL);
        } catch (err) {
          console.warn('theme thumb resize failed:', err.message);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = srcPath;
    });
  }

  function render() {
    return `
    <div class="settings-page">
      <!-- Top row: Google + Claude side by side -->
      <div class="settings-grid-top">
        <!-- Google Account -->
        <div class="glass-card" style="padding:22px;animation:fadeSlideUp 0.5s ease 0.05s both;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
            <div style="width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,rgba(255,107,157,0.15),rgba(232,67,147,0.1));display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent-pink)" stroke-width="1.5" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            </div>
            <div>
              <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;" data-i18n="settings_google">Google Account</h3>
              <div style="font-size:11px;color:var(--text-muted);font-weight:300;">Calendar, Drive & Notes</div>
            </div>
          </div>

          <div id="google-account-status">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:12px;background:rgba(255,107,157,0.04);border:1px solid rgba(255,180,200,0.06);">
              <div style="font-size:12px;color:var(--text-secondary);font-weight:300;">Connect to sync calendar events and notes</div>
              <button class="btn-pink" id="google-connect-btn" style="padding:7px 18px;font-size:11px;flex-shrink:0;">Connect</button>
            </div>
          </div>

          <div style="font-size:10px;color:rgba(253,154,108,0.7);font-weight:300;margin-top:10px;line-height:1.5;">If your Google Cloud project is in testing mode, add your email as a test user in the OAuth consent screen.</div>

          <div id="google-credentials-section" style="margin-top:14px;border-top:1px solid rgba(var(--accent-muted-rgb),0.08);padding-top:14px;">
            <div id="google-advanced-toggle" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;padding:4px 2px;">
              <div style="font-size:11px;color:var(--text-muted);font-weight:300;letter-spacing:0.3px;">Advanced — Custom OAuth Credentials</div>
              <svg id="google-advanced-chevron" viewBox="0 0 24 24" width="14" height="14" stroke="var(--text-muted)" stroke-width="2" fill="none" style="transition:transform 0.25s ease;"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div id="google-advanced-body" style="max-height:0;overflow:hidden;transition:max-height 0.3s ease, margin-top 0.3s ease, opacity 0.3s ease;opacity:0;">
              <div style="font-size:10px;color:var(--text-muted);font-weight:300;line-height:1.6;margin:10px 0 10px 0;">Optional — override the built-in credentials with your own Google Cloud OAuth project.</div>
              <div class="settings-input-group" style="width:100%;margin-bottom:6px;">
                <input class="settings-input" id="google-client-id" type="text" placeholder="Client ID" style="width:100%;">
              </div>
              <div class="settings-input-group" style="width:100%;">
                <input class="settings-input" id="google-client-secret" type="password" placeholder="Client Secret" style="width:100%;">
                <button class="btn-sm" id="save-google-creds">Save</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Bloom AI — Provider selector + keys -->
        <div class="glass-card" style="padding:22px;animation:fadeSlideUp 0.5s ease 0.1s both;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
            <div style="width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,rgba(232,67,147,0.15),rgba(253,154,108,0.1));display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent-rose)" stroke-width="1.5" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div>
              <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;" data-i18n="settings_claude">Bloom AI</h3>
              <div style="font-size:11px;color:var(--text-muted);font-weight:300;">Pick your model — bring your own key</div>
            </div>
          </div>

          <!-- Provider selector (custom dropdown) -->
          <div style="padding:12px 14px;border-radius:12px;background:rgba(var(--accent-primary-rgb),0.04);border:1px solid rgba(var(--accent-muted-rgb),0.06);margin-bottom:10px;">
            <div style="font-size:12px;color:var(--text-secondary);font-weight:300;margin-bottom:8px;">Active model</div>
            <div class="custom-dropdown" id="ai-provider-dropdown" tabindex="0">
              <div class="custom-dropdown-trigger" id="ai-dropdown-trigger">
                <div class="custom-dropdown-selected">
                  <div class="custom-dropdown-dot" id="ai-dropdown-dot"></div>
                  <span id="ai-dropdown-label">Claude Haiku 4.5</span>
                  <span class="custom-dropdown-sublabel" id="ai-dropdown-sublabel">Anthropic · paid</span>
                </div>
                <svg class="custom-dropdown-chevron" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div class="custom-dropdown-menu" id="ai-dropdown-menu">
                <div class="custom-dropdown-option" data-value="claude">
                  <div class="custom-dropdown-dot" style="background:#D97757;color:#D97757;"></div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12.5px;font-weight:400;">Claude Haiku 4.5</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-weight:300;margin-top:2px;">Anthropic · paid · highest quality</div>
                  </div>
                  <svg class="custom-dropdown-check" viewBox="0 0 24 24" width="14" height="14" stroke="var(--accent-pink)" stroke-width="2.5" fill="none"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="custom-dropdown-option" data-value="gemini">
                  <div class="custom-dropdown-dot" style="background:#4285F4;color:#4285F4;"></div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12.5px;font-weight:400;">Gemini 2.5 Flash</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-weight:300;margin-top:2px;">Google · free · 1,500 req/day</div>
                  </div>
                  <svg class="custom-dropdown-check" viewBox="0 0 24 24" width="14" height="14" stroke="var(--accent-pink)" stroke-width="2.5" fill="none"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="custom-dropdown-option" data-value="openrouter">
                  <div class="custom-dropdown-dot" style="background:#A855F7;color:#A855F7;"></div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12.5px;font-weight:400;">Qwen 3 (OpenRouter)</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-weight:300;margin-top:2px;">Qwen via OpenRouter · free · 20/min, 50–1,000/day</div>
                  </div>
                  <svg class="custom-dropdown-check" viewBox="0 0 24 24" width="14" height="14" stroke="var(--accent-pink)" stroke-width="2.5" fill="none"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
            </div>
            <div id="ai-provider-hint" style="font-size:11px;color:var(--text-muted);font-weight:300;margin-top:8px;"></div>
          </div>

          <!-- Claude key -->
          <div id="claude-key-section" style="padding:12px 14px;border-radius:12px;background:rgba(var(--accent-primary-rgb),0.04);border:1px solid rgba(var(--accent-muted-rgb),0.06);margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:12px;color:var(--text-secondary);font-weight:300;">Anthropic API key</div>
              <a href="#" id="claude-key-help" style="font-size:10px;color:var(--accent-pink);text-decoration:none;font-weight:300;">Get a key →</a>
            </div>
            <div class="settings-input-group">
              <input class="settings-input" id="claude-api-key" type="password" placeholder="sk-ant-..." style="flex:1;">
              <button class="btn-sm" id="toggle-claude-visibility" title="Show/Hide">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button class="btn-pink" id="save-claude-key" style="padding:7px 18px;font-size:11px;">Save</button>
            </div>
            <div id="claude-key-status" style="font-size:11px;color:var(--text-muted);margin-top:8px;"></div>
          </div>

          <!-- Gemini key -->
          <div id="gemini-key-section" style="padding:12px 14px;border-radius:12px;background:rgba(var(--accent-primary-rgb),0.04);border:1px solid rgba(var(--accent-muted-rgb),0.06);margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:12px;color:var(--text-secondary);font-weight:300;">Google AI key (free)</div>
              <a href="#" id="gemini-key-help" style="font-size:10px;color:var(--accent-pink);text-decoration:none;font-weight:300;">Get a free key →</a>
            </div>
            <div class="settings-input-group">
              <input class="settings-input" id="gemini-api-key" type="password" placeholder="AIza..." style="flex:1;">
              <button class="btn-sm" id="toggle-gemini-visibility" title="Show/Hide">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button class="btn-pink" id="save-gemini-key" style="padding:7px 18px;font-size:11px;">Save</button>
            </div>
            <div id="gemini-key-status" style="font-size:11px;color:var(--text-muted);margin-top:8px;"></div>
          </div>

          <!-- OpenRouter key (Qwen + other OpenAI-compatible models) -->
          <div id="openrouter-key-section" style="padding:12px 14px;border-radius:12px;background:rgba(var(--accent-primary-rgb),0.04);border:1px solid rgba(var(--accent-muted-rgb),0.06);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:12px;color:var(--text-secondary);font-weight:300;">OpenRouter key (free — Qwen + others)</div>
              <a href="#" id="openrouter-key-help" style="font-size:10px;color:var(--accent-pink);text-decoration:none;font-weight:300;">Get a free key →</a>
            </div>
            <div class="settings-input-group">
              <input class="settings-input" id="openrouter-api-key" type="password" placeholder="sk-or-v1-..." style="flex:1;">
              <button class="btn-sm" id="toggle-openrouter-visibility" title="Show/Hide">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button class="btn-pink" id="save-openrouter-key" style="padding:7px 18px;font-size:11px;">Save</button>
            </div>
            <div id="openrouter-key-status" style="font-size:11px;color:var(--text-muted);margin-top:8px;"></div>

            <!-- Model picker — uses .custom-dropdown (NOT native <select>)
                 because native selects render their option list with OS
                 chrome that ignores CSS, producing the all-white dropdown
                 the user reported. CLAUDE.md "Custom Dropdown Component"
                 documents this trap and the pattern below is the fix. -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;margin-bottom:6px;">
              <div style="font-size:12px;color:var(--text-secondary);font-weight:300;">Model</div>
              <span style="font-size:10px;color:var(--text-muted);font-weight:300;">free tier</span>
            </div>
            <!-- opens-upward modifier — this dropdown sits at the bottom of
                 the AI provider .glass-card (which has overflow:hidden), so
                 the menu would be clipped if it opened downward. .opens-upward
                 anchors the menu above the trigger instead. -->
            <!-- Order matters: most-reliably-served first. The 235B model
                 was the previous default but OpenRouter's free endpoints
                 for it have been intermittently 404-ing ("No endpoints
                 found"), so it's demoted with a "may be unavailable" hint. -->
            <div class="custom-dropdown opens-upward" id="openrouter-model-dropdown" tabindex="0">
              <div class="custom-dropdown-trigger" id="openrouter-model-trigger">
                <div class="custom-dropdown-selected">
                  <div class="custom-dropdown-dot" style="background:#A855F7;color:#A855F7;"></div>
                  <span id="openrouter-model-label">Qwen 3 Coder 480B</span>
                  <span class="custom-dropdown-sublabel" id="openrouter-model-sublabel">recommended · 262K context</span>
                </div>
                <svg class="custom-dropdown-chevron" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div class="custom-dropdown-menu" id="openrouter-model-menu">
                <div class="custom-dropdown-option" data-value="qwen/qwen3-coder:free">
                  <div class="custom-dropdown-dot" style="background:#A855F7;color:#A855F7;border:1px solid var(--accent-warm);"></div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12.5px;font-weight:400;">Qwen 3 Coder 480B</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-weight:300;margin-top:2px;">recommended · 262K context · most reliably served</div>
                  </div>
                  <svg class="custom-dropdown-check" viewBox="0 0 24 24" width="14" height="14" stroke="var(--accent-pink)" stroke-width="2.5" fill="none"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="custom-dropdown-option" data-value="qwen/qwen3-next-80b-a3b-instruct:free">
                  <div class="custom-dropdown-dot" style="background:#A855F7;color:#A855F7;opacity:0.85;"></div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12.5px;font-weight:400;">Qwen 3 Next 80B</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-weight:300;margin-top:2px;">newer architecture · 3B active (MoE) · good for general chat</div>
                  </div>
                  <svg class="custom-dropdown-check" viewBox="0 0 24 24" width="14" height="14" stroke="var(--accent-pink)" stroke-width="2.5" fill="none"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom row: Language + About side by side -->
      <div class="settings-grid-bottom">
        <!-- Language -->
        <div class="glass-card" style="padding:22px;animation:fadeSlideUp 0.5s ease 0.2s both;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div style="width:42px;height:42px;border-radius:14px;background:rgba(250,177,196,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent-blush)" stroke-width="1.5" fill="none"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;" data-i18n="settings_language">Language</h3>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:12px;background:rgba(255,107,157,0.04);border:1px solid rgba(255,180,200,0.06);">
            <div style="font-size:12px;color:var(--text-secondary);font-weight:300;">Display Language</div>
            <div class="lang-toggle">
              <button class="lang-btn active" data-lang="en" id="settings-lang-en">EN</button>
              <button class="lang-btn" data-lang="es" id="settings-lang-es">ES</button>
            </div>
          </div>
        </div>

        <!-- About -->
        <div class="glass-card" style="padding:22px;animation:fadeSlideUp 0.5s ease 0.25s both;">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
            <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,var(--accent-pink),var(--accent-rose));display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(232,67,147,0.3);flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="22" height="22" stroke="white" stroke-width="1.8" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <div>
              <div style="font-size:15px;font-weight:400;">Bloom</div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:300;" id="app-version">v1.0.0</div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);font-weight:300;line-height:1.7;padding:10px 14px;border-radius:12px;background:rgba(255,107,157,0.04);border:1px solid rgba(255,180,200,0.06);">
            Your personal productivity dashboard with Google Calendar, cloud-synced Notes, and Bloom AI Assistant.
          </div>
        </div>
      </div>

      <!-- Appearance Section — themes + blur slider + (future) other visual prefs. -->
      <div class="glass-card" style="padding:22px;animation:fadeSlideUp 0.5s ease 0.3s both;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
          <div style="width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,var(--accent-pink),var(--accent-warm));display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="white" stroke-width="1.5" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
          <div>
            <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;">Appearance</h3>
            <div style="font-size:11px;color:var(--text-muted);font-weight:300;">Theme, blur, & colors</div>
          </div>
        </div>

        <!-- Blur slider — live-controls the --glass-sub-blur variable. Smaller
             values = more GPU-friendly; user can tune to taste and see the
             change immediately across every glass-card in the app. -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:10px;color:var(--text-secondary);font-weight:400;letter-spacing:0.5px;text-transform:uppercase;">Glass Blur</div>
          <div id="blur-value-label" style="font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums;">24 px</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <span style="font-size:10px;color:var(--text-muted);font-weight:300;">Off</span>
          <input type="range" id="blur-slider" min="0" max="60" step="1" value="24"
                 style="flex:1;"
                 aria-label="Glass blur radius">
          <span style="font-size:10px;color:var(--text-muted);font-weight:300;">Heavy</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:300;margin-bottom:16px;font-style:italic;">Lower = smoother scrolling. Higher = more frosted look. 24 px is a good default.</div>

        <div style="font-size:11px;color:var(--text-muted);font-weight:300;margin-bottom:10px;">Choose a background — colors will automatically adapt to match.</div>
        <div style="font-size:10px;color:var(--text-secondary);font-weight:400;margin-bottom:6px;letter-spacing:0.5px;text-transform:uppercase;">Presets</div>
        <div class="theme-presets" id="theme-presets">
          ${Object.entries(ThemeEngine.PRESETS).map(([key, preset]) => `
            <div class="theme-preset-item" data-preset="${key}" title="${preset.name}">
              <div class="theme-preset-thumb" data-preset="${key}"></div>
              <div class="theme-preset-name">${preset.name}</div>
            </div>
          `).join('')}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;margin-bottom:6px;">
          <div style="font-size:10px;color:var(--text-secondary);font-weight:400;letter-spacing:0.5px;text-transform:uppercase;">My Themes</div>
          <button class="btn-sm" id="theme-custom-btn" style="padding:4px 12px;font-size:10px;">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px;vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Image
          </button>
        </div>
        <div class="theme-presets" id="theme-custom-grid">
          <div style="grid-column:1/-1;text-align:center;padding:12px;color:var(--text-muted);font-size:11px;font-weight:300;">Loading...</div>
        </div>
      </div>
    </div>`;
  }

  async function init() {
    // Load Google connection status
    await loadGoogleStatus();

    // Load AI provider + key statuses
    await loadAIProviderStatus();

    // Load saved Google credentials
    await loadGoogleCredentials();

    // Claude + Gemini + OpenRouter key saves
    document.getElementById('save-claude-key')?.addEventListener('click', saveClaudeKey);
    document.getElementById('save-gemini-key')?.addEventListener('click', saveGeminiKey);
    document.getElementById('save-openrouter-key')?.addEventListener('click', saveOpenRouterKey);

    // Model picker for OpenRouter — uses .custom-dropdown (NOT native
    // <select>) so the option list inherits the glass-morphism styling
    // instead of the OS's default white dropdown chrome.
    const modelDropdown = document.getElementById('openrouter-model-dropdown');
    const modelTrigger = document.getElementById('openrouter-model-trigger');
    modelTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      modelDropdown?.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (modelDropdown && !modelDropdown.contains(e.target)) modelDropdown.classList.remove('open');
    });
    const MODEL_LABELS = {
      'qwen/qwen3-coder:free':                 { label: 'Qwen 3 Coder 480B', sublabel: 'recommended · 262K context' },
      'qwen/qwen3-next-80b-a3b-instruct:free': { label: 'Qwen 3 Next 80B',   sublabel: 'newer architecture · MoE' },
    };
    document.querySelectorAll('#openrouter-model-menu .custom-dropdown-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        if (!window.electronAPI) return;
        const model = opt.dataset.value;
        modelDropdown?.classList.remove('open');
        try {
          const result = await window.electronAPI.openrouter.setModel(model);
          if (result?.success) {
            const info = MODEL_LABELS[model] || { label: model, sublabel: '' };
            const labelEl = document.getElementById('openrouter-model-label');
            const subEl = document.getElementById('openrouter-model-sublabel');
            if (labelEl) labelEl.textContent = info.label;
            if (subEl) subEl.textContent = info.sublabel;
            document.querySelectorAll('#openrouter-model-menu .custom-dropdown-option').forEach(o => {
              o.classList.toggle('selected', o.dataset.value === model);
            });
            Toast.show(`Model set to ${info.label}`, 'success');
          } else {
            Toast.show(result?.error || 'Failed to change model', 'error');
          }
        } catch (err) {
          Toast.show('Failed to change model', 'error');
        }
      });
    });

    // Custom AI provider dropdown — open/close
    const dropdown = document.getElementById('ai-provider-dropdown');
    const trigger = document.getElementById('ai-dropdown-trigger');
    const menu = document.getElementById('ai-dropdown-menu');

    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown?.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (dropdown && !dropdown.contains(e.target)) dropdown.classList.remove('open');
    });

    // Option selection
    document.querySelectorAll('#ai-dropdown-menu .custom-dropdown-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        if (!window.electronAPI) return;
        const val = opt.dataset.value;
        dropdown?.classList.remove('open');
        try {
          await window.electronAPI.ai.setProvider(val);
          const nameByVal = {
            claude: 'Claude Haiku 4.5',
            gemini: 'Gemini 2.5 Flash',
            openrouter: 'Qwen 3 (OpenRouter)',
          };
          Toast.show(`Switched to ${nameByVal[val] || val}`, 'success');
          await loadAIProviderStatus();
        } catch (err) {
          Toast.show('Failed to switch provider', 'error');
        }
      });
    });

    // Google Advanced collapse toggle
    const advToggle = document.getElementById('google-advanced-toggle');
    const advBody = document.getElementById('google-advanced-body');
    const advChevron = document.getElementById('google-advanced-chevron');
    advToggle?.addEventListener('click', () => {
      const isOpen = advBody.style.maxHeight && advBody.style.maxHeight !== '0px';
      if (isOpen) {
        advBody.style.maxHeight = '0';
        advBody.style.opacity = '0';
        advBody.style.marginTop = '0';
        advChevron.style.transform = 'rotate(0deg)';
      } else {
        advBody.style.maxHeight = advBody.scrollHeight + 'px';
        advBody.style.opacity = '1';
        advBody.style.marginTop = '4px';
        advChevron.style.transform = 'rotate(180deg)';
      }
    });

    // "Get a key" helper links — open in external browser
    document.getElementById('claude-key-help')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI?.app?.openExternal?.('https://console.anthropic.com/settings/keys');
    });
    document.getElementById('gemini-key-help')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI?.app?.openExternal?.('https://aistudio.google.com/apikey');
    });
    document.getElementById('openrouter-key-help')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI?.app?.openExternal?.('https://openrouter.ai/settings/keys');
    });

    // Appearance: blur slider — sync to stored value, wire live-update + debounced persist.
    _initBlurSlider();

    // Theme presets
    loadThemeThumbnails();
    loadCustomThemes();
    document.querySelectorAll('.theme-preset-item[data-preset]').forEach(item => {
      item.addEventListener('click', async () => {
        document.querySelectorAll('.theme-preset-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        await ThemeEngine.applyPreset(item.dataset.preset);
      });
    });

    // Upload custom image
    document.getElementById('theme-custom-btn')?.addEventListener('click', async () => {
      if (!window.electronAPI) return;
      const customTheme = await window.electronAPI.theme.pickImage();
      if (customTheme) {
        document.querySelectorAll('.theme-preset-item').forEach(i => i.classList.remove('active'));
        await ThemeEngine.applyCustomImage(customTheme);
        await loadCustomThemes(); // Refresh the grid
        highlightActiveTheme();
      }
    });

    // Highlight current theme
    highlightActiveTheme();

    // Toggle key visibility (both keys)
    document.getElementById('toggle-claude-visibility')?.addEventListener('click', () => {
      const input = document.getElementById('claude-api-key');
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('toggle-gemini-visibility')?.addEventListener('click', () => {
      const input = document.getElementById('gemini-api-key');
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('toggle-openrouter-visibility')?.addEventListener('click', () => {
      const input = document.getElementById('openrouter-api-key');
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });

    // Google connect
    document.getElementById('google-connect-btn')?.addEventListener('click', connectGoogle);

    // Save Google credentials
    document.getElementById('save-google-creds')?.addEventListener('click', saveGoogleCredentials);

    // Language toggle in settings
    document.querySelectorAll('#settings-lang-en, #settings-lang-es').forEach(btn => {
      btn.addEventListener('click', () => I18n.setLang(btn.dataset.lang));
    });

    // App version
    if (window.electronAPI) {
      try {
        const version = await window.electronAPI.app.getVersion();
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.textContent = `v${version}`;
      } catch {}
    }
  }

  async function loadGoogleStatus() {
    if (!window.electronAPI) return;
    try {
      const status = await window.electronAPI.google.getStatus();
      const container = document.getElementById('google-account-status');
      const btn = document.getElementById('google-connect-btn');
      if (!container || !btn) return;

      if (status.authenticated) {
        let profileName = 'Google User';
        let profileEmail = '';
        let profilePic = '';
        try {
          const profile = await window.electronAPI.google.getProfile();
          if (profile) {
            profileName = profile.name || 'Google User';
            profileEmail = profile.email || '';
            profilePic = profile.picture || '';
          }
        } catch {}

        // Build via DOM construction — profileName/Email/Pic are all
        // attacker-influenceable (compromised Google account). The previous
        // `${profileName}` interpolation into innerHTML allowed `"><img...>`
        // payloads to run arbitrary JS in the renderer.
        while (container.firstChild) container.removeChild(container.firstChild);
        const card = document.createElement('div');
        card.className = 'account-card';
        if (profilePic && /^https:\/\//i.test(profilePic)) {
          const img = document.createElement('img');
          img.src = profilePic;
          img.alt = '';
          card.appendChild(img);
        } else {
          const initial = document.createElement('div');
          initial.className = 'msg-avatar a';
          initial.style.width = '32px';
          initial.style.height = '32px';
          initial.textContent = (profileName || '?').charAt(0);
          card.appendChild(initial);
        }
        const info = document.createElement('div');
        info.className = 'account-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'account-name';
        nameEl.textContent = profileName;
        const emailEl = document.createElement('div');
        emailEl.className = 'account-email';
        emailEl.textContent = profileEmail;
        info.appendChild(nameEl);
        info.appendChild(emailEl);
        card.appendChild(info);
        const signOut = document.createElement('button');
        signOut.className = 'btn-sm danger';
        signOut.id = 'google-disconnect-btn';
        signOut.textContent = 'Sign Out';
        card.appendChild(signOut);
        container.appendChild(card);
        signOut.addEventListener('click', disconnectGoogle);
      }
    } catch {}
  }

  async function loadGoogleCredentials() {
    if (!window.electronAPI) return;
    try {
      const clientId = await window.electronAPI.store.get('google.clientId');
      if (clientId) {
        document.getElementById('google-client-id').value = clientId;
        document.getElementById('google-client-id').placeholder = 'Client ID (saved)';
      }
    } catch {}
  }

  async function saveGoogleCredentials() {
    if (!window.electronAPI) return;
    const clientId = document.getElementById('google-client-id')?.value.trim();
    const clientSecret = document.getElementById('google-client-secret')?.value.trim();

    if (!clientId || !clientSecret) {
      Toast.show('Please enter both Client ID and Client Secret', 'warning');
      return;
    }

    await window.electronAPI.store.set('google.clientId', clientId);
    await window.electronAPI.store.setSecure('google.clientSecret', clientSecret);
    Toast.show('Google credentials saved', 'success');
  }

  async function connectGoogle() {
    if (!window.electronAPI) return;
    try {
      Toast.show('Opening Google sign-in...', 'info');
      const result = await window.electronAPI.google.login();
      if (result.success) {
        Toast.show('Connected to Google!', 'success');
        await loadGoogleStatus();
        Header.updateWithProfile();
      } else {
        Toast.show(result.error || 'Failed to connect', 'error');
      }
    } catch (err) {
      Toast.show('Connection failed', 'error');
    }
  }

  async function disconnectGoogle() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.google.logout();

      // Clear cached identity so next launch shows neutral defaults
      try {
        await window.electronAPI.store.delete('user.firstName');
        await window.electronAPI.store.delete('user.fullName');
        await window.electronAPI.store.delete('user.avatarUrl');
      } catch {}

      Toast.show('Signed out from Google', 'info');

      // Reset the Google account section back to Connect button
      const container = document.getElementById('google-account-status');
      if (container) {
        container.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:12px;background:rgba(var(--accent-primary-rgb),0.04);border:1px solid rgba(var(--accent-muted-rgb),0.06);">
            <div style="font-size:12px;color:var(--text-secondary);font-weight:300;">Connect to sync calendar events and notes</div>
            <button class="btn-pink" id="google-connect-btn" style="padding:7px 18px;font-size:11px;flex-shrink:0;">Connect</button>
          </div>`;
        document.getElementById('google-connect-btn')?.addEventListener('click', connectGoogle);
      }

      // Reset header avatar to neutral icon
      const headerAvatar = document.getElementById('btn-avatar');
      if (headerAvatar) {
        headerAvatar.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      }

      // Reset header greeting
      Header.updateGreeting();
    } catch (err) {
      Toast.show('Failed to sign out', 'error');
    }
  }

  async function loadAIProviderStatus() {
    if (!window.electronAPI) return;
    try {
      const status = await window.electronAPI.ai.getProviderStatus();
      const active = status.active;

      // Update custom dropdown trigger display
      // Provider dots use fixed brand colors (NOT theme accents) so they
      // remain visually distinct regardless of which background theme is active.
      const PROVIDER_COLORS = {
        claude: '#D97757',     // Anthropic coral/terra
        gemini: '#4285F4',     // Google blue
        openrouter: '#A855F7'  // OpenRouter purple (their brand hue)
      };
      const PROVIDER_LABELS = {
        claude: { label: 'Claude Haiku 4.5', sublabel: 'Anthropic · paid' },
        gemini: { label: 'Gemini 2.5 Flash', sublabel: 'Google · free' },
        openrouter: { label: 'Qwen 3 (OpenRouter)', sublabel: 'Qwen · free' }
      };
      const info = PROVIDER_LABELS[active] || PROVIDER_LABELS.claude;
      const color = PROVIDER_COLORS[active] || PROVIDER_COLORS.claude;
      const label = document.getElementById('ai-dropdown-label');
      const sublabel = document.getElementById('ai-dropdown-sublabel');
      const dot = document.getElementById('ai-dropdown-dot');
      if (label) label.textContent = info.label;
      if (sublabel) sublabel.textContent = info.sublabel;
      if (dot) { dot.style.background = color; dot.style.color = color; }

      // Mark the selected option in the menu
      document.querySelectorAll('#ai-dropdown-menu .custom-dropdown-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === active);
      });

      // Update hint below the dropdown
      const hintEl = document.getElementById('ai-provider-hint');
      if (hintEl) {
        const activeInfo = status.providers[active];
        const needsKey = !activeInfo.hasKey;
        hintEl.innerHTML = needsKey
          ? `<span style="color:var(--accent-warm);">⚠ ${activeInfo.label} needs an API key below to work</span>`
          : `<span style="color:#6fdb8b;">✓ ${activeInfo.label} is ready</span> · ${activeInfo.description}`;
      }

      // Update each key status
      await updateKeyStatus('claude', status.providers.claude.hasKey);
      await updateKeyStatus('gemini', status.providers.gemini.hasKey);
      await updateKeyStatus('openrouter', status.providers.openrouter.hasKey);

      // Sync the custom model-picker dropdown to what's currently saved.
      try {
        const currentModel = await window.electronAPI.openrouter.getModel();
        if (currentModel) {
          const MODEL_LABELS = {
            'qwen/qwen3-235b-a22b:free': { label: 'Qwen 3 235B', sublabel: 'balanced, recommended' },
            'qwen/qwen3-30b-a3b:free':   { label: 'Qwen 3 30B',  sublabel: 'faster, lighter' },
            'qwen/qwen3-coder:free':     { label: 'Qwen 3 Coder 480B', sublabel: 'best for code' },
          };
          const info = MODEL_LABELS[currentModel];
          if (info) {
            const labelEl = document.getElementById('openrouter-model-label');
            const subEl = document.getElementById('openrouter-model-sublabel');
            if (labelEl) labelEl.textContent = info.label;
            if (subEl) subEl.textContent = info.sublabel;
          }
          document.querySelectorAll('#openrouter-model-menu .custom-dropdown-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.value === currentModel);
          });
        }
      } catch {}
    } catch (err) {
      console.error('Failed to load AI provider status:', err);
    }
  }

  async function updateKeyStatus(provider, hasKey) {
    const statusEl = document.getElementById(`${provider}-key-status`);
    if (!statusEl) return;
    if (hasKey) {
      try {
        const { preview } = await window.electronAPI[provider].getApiKeyPreview();
        statusEl.innerHTML = `<span style="color:#6fdb8b;">Key is set</span> <span style="font-family:monospace;color:var(--text-secondary);margin-left:6px;">${preview || ''}</span>`;
      } catch {
        statusEl.innerHTML = `<span style="color:#6fdb8b;">Key is set</span>`;
      }
    } else {
      statusEl.textContent = 'No key configured';
      statusEl.style.color = 'var(--text-muted)';
    }
  }

  async function saveClaudeKey() {
    if (!window.electronAPI) return;
    const input = document.getElementById('claude-api-key');
    const key = input?.value.trim();
    if (!key) {
      Toast.show('Please enter an API key', 'warning');
      return;
    }
    if (!key.startsWith('sk-ant-')) {
      Toast.show('Claude keys start with "sk-ant-" — double-check your key', 'warning');
      // Still save, but warn
    }
    const statusEl = document.getElementById('claude-key-status');
    try {
      await window.electronAPI.claude.setApiKey(key);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted);">⏳ Validating key with Anthropic...</span>';

      // Immediately validate the key by making a 1-token test request
      const result = await window.electronAPI.claude.validateKey();
      if (result.valid) {
        Toast.show('Claude API key saved and verified!', 'success');
      } else {
        // Surface the friendlier diagnostic the service produced verbatim
        // (it already disambiguates "no credits" vs "bad key" vs "model
        // unavailable") and give the toast extra time so the user can read it.
        Toast.show(result.error || 'Key saved but validation failed.', 'error', 9000);
      }
      await loadAIProviderStatus();
    } catch (err) {
      Toast.show('Failed to save API key', 'error');
    } finally {
      // Always wipe the input — even on synchronous setApiKey failure the
      // key would otherwise stay in the DOM (DevTools open in dev mode
      // would expose it). Moved out of the try block for that reason.
      if (input) input.value = '';
    }
  }

  async function saveGeminiKey() {
    if (!window.electronAPI) return;
    const input = document.getElementById('gemini-api-key');
    const key = input?.value.trim();
    if (!key) {
      Toast.show('Please enter an API key', 'warning');
      return;
    }
    if (!key.startsWith('AIza')) {
      Toast.show('Gemini keys usually start with "AIza" — double-check your key', 'warning');
    }
    const statusEl = document.getElementById('gemini-key-status');
    try {
      await window.electronAPI.gemini.setApiKey(key);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted);">⏳ Validating key with Google...</span>';

      const result = await window.electronAPI.gemini.validateKey();
      if (result.valid) {
        Toast.show('Gemini API key saved and verified!', 'success');
      } else {
        const msg = /invalid|401|403|permission/i.test(result.error || '')
          ? 'Key saved but Google rejected it. Double-check you copied the full key from aistudio.google.com/apikey.'
          : `Key saved but validation failed: ${result.error || 'unknown error'}`;
        Toast.show(msg, 'error', 7000);
      }
      await loadAIProviderStatus();
    } catch (err) {
      Toast.show('Failed to save API key', 'error');
    } finally {
      // See saveClaudeKey — clear in finally so synchronous throws don't
      // leave the plaintext key in the DOM.
      if (input) input.value = '';
    }
  }

  async function saveOpenRouterKey() {
    if (!window.electronAPI) return;
    const input = document.getElementById('openrouter-api-key');
    const key = input?.value.trim();
    if (!key) {
      Toast.show('Please enter an API key', 'warning');
      return;
    }
    if (!/^sk-or-/.test(key)) {
      Toast.show('OpenRouter keys start with "sk-or-v1-" — double-check your key', 'warning');
    }
    const statusEl = document.getElementById('openrouter-key-status');
    try {
      await window.electronAPI.openrouter.setApiKey(key);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted);">⏳ Validating key with OpenRouter...</span>';
      const result = await window.electronAPI.openrouter.validateKey();
      if (result.valid) {
        Toast.show('OpenRouter key saved and verified!', 'success');
      } else {
        const msg = /401|invalid/i.test(result.error || '')
          ? 'Key saved but OpenRouter rejected it. Double-check you copied the full key from openrouter.ai/keys.'
          : `Key saved but validation failed: ${result.error || 'unknown error'}`;
        Toast.show(msg, 'error', 7000);
      }
      await loadAIProviderStatus();
    } catch (err) {
      Toast.show('Failed to save API key', 'error');
    } finally {
      // See saveClaudeKey for why the clear happens in `finally`.
      if (input) input.value = '';
    }
  }

  async function loadCustomThemes() {
    if (!window.electronAPI) return;
    const grid = document.getElementById('theme-custom-grid');
    if (!grid) return;

    try {
      const customs = await window.electronAPI.theme.listCustom();
      if (customs.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-weight:300;">No custom themes yet. Click "Add Image" to upload one.</div>`;
        return;
      }

      // Build via DOM construction — `ct.name` and `ct.path` come from the
      // user's filesystem (basename of whatever image they picked) and a
      // crafted filename like `evil"><script>alert(1)</script>.png` would
      // execute JS via the `title="..."` and `style="..."` attributes
      // when interpolated raw. DOM construction + setAttribute / textContent
      // is unconditionally safe.
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      // Kick off all the canvas-resize jobs in parallel so the initial
      // render isn't serialized waiting on each decode.
      for (const ct of customs) {
        const item = document.createElement('div');
        item.className = 'theme-preset-item';
        item.dataset.customId = ct.id;
        item.dataset.customPath = ct.path;
        item.title = ct.name;

        const thumb = document.createElement('div');
        thumb.className = 'theme-preset-thumb';
        // Use <img> with a canvas-downsampled data URL (see
        // _getResizedThumb). Custom themes especially benefit — user-
        // uploaded images can be arbitrary sizes including huge phone
        // photos, and we were re-decoding them on every scroll. After
        // the first decode, the small thumb data URL stays cached for
        // the session, so re-visiting Settings is instant.
        const src = `file://${String(ct.path).replace(/\\/g, '/')}`;
        const img = document.createElement('img');
        img.decoding = 'async';
        img.alt = String(ct.name || 'Custom theme');
        img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
        // Resolve the resized URL without blocking the outer loop —
        // the DOM tree gets built immediately; images swap in as
        // their resizes complete (each independently).
        _getResizedThumb(src).then(resized => { img.src = resized || src; });
        thumb.appendChild(img);
        item.appendChild(thumb);

        const del = document.createElement('button');
        del.className = 'theme-delete-btn';
        del.dataset.deleteId = ct.id;
        del.title = 'Remove';
        del.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        thumb.appendChild(del);

        const name = document.createElement('div');
        name.className = 'theme-preset-name';
        name.textContent = String(ct.name || '').replace(/^custom_\d+$/, 'Custom');
        item.appendChild(name);

        grid.appendChild(item);
      }

      // Click to apply custom theme
      grid.querySelectorAll('.theme-preset-item[data-custom-id]').forEach(item => {
        item.addEventListener('click', async (e) => {
          if (e.target.closest('.theme-delete-btn')) return; // Don't apply when clicking delete
          document.querySelectorAll('.theme-preset-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          await ThemeEngine.applyCustomImage({ id: item.dataset.customId, path: item.dataset.customPath });
        });
      });

      // Delete buttons
      grid.querySelectorAll('.theme-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.deleteId;
          await window.electronAPI.theme.deleteCustom(id);
          Toast.show('Theme removed', 'info');
          await loadCustomThemes();
        });
      });

      highlightActiveTheme();
    } catch (err) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:12px;color:var(--text-muted);font-size:11px;">Failed to load custom themes</div>`;
    }
  }

  // ─── Blur slider (Appearance section) ────────────────────────────
  // Applies a live value to the `--glass-sub-blur` CSS variable, which
  // every .glass-card + backdrop-filter-using element reads. Persists
  // to store under `appearance.blur` (0-60 int). On next app launch,
  // theme-engine / app.js applies the stored value before first paint.
  //
  // Live-update on `input` (dragging), debounced-persist on `change`
  // (drag-release) so we don't hammer disk with one write per pixel.
  const BLUR_MIN = 0;
  const BLUR_MAX = 60;
  const BLUR_DEFAULT = 24;

  function _applyBlur(px) {
    const n = Math.max(BLUR_MIN, Math.min(BLUR_MAX, parseInt(px, 10) || BLUR_DEFAULT));
    // saturate(1.3) kept constant — blur is the perceptually dominant
    // axis and also the one with the real perf cost. If a user slides
    // blur to 0 we still want a mild saturation boost on glass cards
    // so they don't look flatly gray against the wallpaper.
    document.documentElement.style.setProperty('--glass-sub-blur', `blur(${n}px) saturate(1.3)`);
    document.documentElement.style.setProperty('--glass-blur', `${n}px`);
    const label = document.getElementById('blur-value-label');
    if (label) label.textContent = `${n} px`;
  }

  async function _initBlurSlider() {
    const slider = document.getElementById('blur-slider');
    if (!slider) return;

    // Load saved value (or default). Store returns undefined for unset keys.
    let saved = BLUR_DEFAULT;
    if (window.electronAPI) {
      try {
        const stored = await window.electronAPI.store.get('appearance.blur');
        if (typeof stored === 'number' && stored >= BLUR_MIN && stored <= BLUR_MAX) {
          saved = stored;
        }
      } catch {}
    }
    slider.value = String(saved);
    _applyBlur(saved);

    // Live preview while dragging — don't write to disk here.
    slider.addEventListener('input', (e) => _applyBlur(e.target.value));
    // Persist on release (change fires once, not per frame).
    slider.addEventListener('change', async (e) => {
      const n = parseInt(e.target.value, 10);
      if (!Number.isFinite(n)) return;
      try {
        await window.electronAPI.store.set('appearance.blur', n);
      } catch {
        // Store write might fail if the allowlist isn't updated — the
        // live preview still works for the session, just won't persist.
        console.warn('Failed to persist blur preference');
      }
    });
  }

  async function loadThemeThumbnails() {
    if (!window.electronAPI) return;
    // Each thumb gets a canvas-downsampled data URL from the full-res
    // source (see _getResizedThumb). Cached after first load, so when
    // the user re-enters Settings the thumbs appear instantly.
    // Explicitly NO `loading="lazy"` — the whole point of this path is
    // to decode once, keep the tiny bitmap, and never re-decode. Lazy
    // loading + content-visibility:auto were CAUSING the scroll churn
    // the user reported by re-decoding on every re-entry into viewport.
    for (const [key, preset] of Object.entries(ThemeEngine.PRESETS)) {
      const thumb = document.querySelector(`.theme-preset-thumb[data-preset="${key}"]`);
      if (!thumb) continue;
      try {
        const imgPath = await window.electronAPI.theme.getPresetPath(preset.file);
        // Mobile bundles return webview-relative paths (leading "/") — don't
        // wrap those with file:// since Capacitor serves from https://localhost.
        const normalized = String(imgPath).replace(/\\/g, '/');
        const src = /^(\/|https?:|file:|data:)/.test(normalized)
          ? normalized
          : `file://${normalized}`;
        const resized = await _getResizedThumb(src);
        const img = document.createElement('img');
        img.decoding = 'async';
        img.alt = preset.name || key;
        img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
        // Fall back to the original path if resize failed for any reason.
        img.src = resized || src;
        thumb.textContent = ''; // clear any placeholder
        thumb.appendChild(img);
      } catch {}
    }
  }

  async function highlightActiveTheme() {
    if (!window.electronAPI) return;
    try {
      const theme = await window.electronAPI.store.get('theme');
      if (!theme) return;
      document.querySelectorAll('.theme-preset-item').forEach(i => i.classList.remove('active'));
      if (theme.preset) {
        document.querySelector(`.theme-preset-item[data-preset="${theme.preset}"]`)?.classList.add('active');
      } else if (theme.customId) {
        document.querySelector(`.theme-preset-item[data-custom-id="${theme.customId}"]`)?.classList.add('active');
      }
    } catch {}
  }

  function destroy() {}

  return { render, init, destroy };
})();
