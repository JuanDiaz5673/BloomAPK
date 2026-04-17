// ─── Theme Engine ───
// Extracts dominant colors from background image and generates CSS variable palette
const ThemeEngine = (() => {
  const PRESETS = {
    flowers: { name: 'Flowers', file: 'flowers.png' },
    ocean:   { name: 'Ocean',   file: 'ocean.png' },
    forest:  { name: 'Forest',  file: 'forest.png' },
    sunset:  { name: 'Sunset',  file: 'sunset.png' },
    night:   { name: 'Night',   file: 'night.png' },
    aurora:  { name: 'Aurora',  file: 'aurora.png' }
  };

  // ─── Color Utilities ───
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h * 360, s * 100, l * 100];
  }

  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  // Session-scoped palette cache keyed on imageSrc. Extraction does
  // 25,600 canvas pixel reads + an HSL sort on the main thread — about
  // 10ms per run. The previous code re-extracted on EVERY preset apply
  // (including repeat selections of the same preset, which is common
  // when users are browsing themes), and on every app boot.
  // For boot: a cached palette is already persisted under `theme` in
  // the store, so loadSavedTheme never calls extractColors at all.
  // This in-memory cache covers the remaining "switch to Forest, then
  // back to Ocean, then back to Forest" navigation path.
  const _paletteCache = new Map();

  // ─── Color Extraction ───
  function extractColors(imageSrc) {
    if (_paletteCache.has(imageSrc)) {
      return Promise.resolve(_paletteCache.get(imageSrc));
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 80; // Downscale for speed
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        // Single-pass pixel scan: collect relevant pixels AND compute
        // the darkest-decile threshold without ever sorting all 25k
        // entries. Previously an allSorted.sort() over the whole pixel
        // array was the most expensive operation in the extractor.
        const pixels = [];
        const lHistogram = new Uint32Array(100); // bucket by integer lightness %
        for (let i = 0; i < data.length; i += 4) {
          const [h, s, l] = rgbToHsl(data[i], data[i+1], data[i+2]);
          if (s > 8 && l > 5 && l < 90) {
            pixels.push({ h, s, l });
            lHistogram[Math.min(99, l | 0)]++;
          }
        }

        if (pixels.length === 0) {
          const fallback = getDefaultPalette();
          _paletteCache.set(imageSrc, fallback);
          resolve(fallback);
          return;
        }

        // Bucket pixels by hue (12 sectors of 30°) for primary-color detection
        const buckets = Array.from({ length: 12 }, () => []);
        for (const p of pixels) {
          const idx = Math.floor(p.h / 30) % 12;
          buckets[idx].push(p);
        }

        let bestBucket = 0, bestScore = 0;
        for (let i = 0; i < buckets.length; i++) {
          const bucket = buckets[i];
          if (bucket.length === 0) continue;
          let satSum = 0;
          for (const p of bucket) satSum += p.s;
          const avgSat = satSum / bucket.length;
          const score = bucket.length * (avgSat / 50);
          if (score > bestScore) { bestScore = score; bestBucket = i; }
        }

        const primaryPixels = buckets[bestBucket];
        let hSum = 0, sSum = 0;
        for (const p of primaryPixels) { hSum += p.h; sSum += p.s; }
        const avgH = hSum / primaryPixels.length;
        const avgS = Math.min(75, sSum / primaryPixels.length);
        const avgL = 55;

        // Darkest decile via histogram threshold — O(100) instead of
        // O(n log n). Walk the histogram from the bottom until we've
        // accumulated ~10% of pixels, use that L threshold to filter.
        const tenPct = Math.max(10, Math.floor(pixels.length * 0.1));
        let cumulative = 0;
        let lThreshold = 99;
        for (let i = 0; i < 100; i++) {
          cumulative += lHistogram[i];
          if (cumulative >= tenPct) { lThreshold = i; break; }
        }
        let darkHSum = 0, darkSSum = 0, darkCount = 0;
        for (const p of pixels) {
          if (p.l <= lThreshold) {
            darkHSum += p.h; darkSSum += p.s; darkCount++;
          }
        }
        const darkH = darkCount ? darkHSum / darkCount : avgH;
        const darkS = darkCount ? darkSSum / darkCount : avgS;

        const palette = generatePalette(avgH, avgS, avgL, darkH, Math.min(40, darkS));
        _paletteCache.set(imageSrc, palette);
        resolve(palette);
      };
      img.onerror = () => {
        const fallback = getDefaultPalette();
        _paletteCache.set(imageSrc, fallback);
        resolve(fallback);
      };
      img.src = imageSrc;
    });
  }

  function getDefaultPalette() {
    return generatePalette(340, 70, 55, 340, 30); // Original pink theme
  }

  function generatePalette(hue, sat, light, darkHue, darkSat) {
    const primary = hslToRgb(hue, sat, light);
    const secondary = hslToRgb((hue + 30) % 360, Math.max(40, sat - 10), light - 5);
    const muted = hslToRgb(hue, Math.max(30, sat - 25), light + 15);
    const warm = hslToRgb((hue - 30 + 360) % 360, Math.max(40, sat - 5), light + 5);

    const pr = primary, sr = secondary, mr = muted, wr = warm;

    return {
      // Accent hex colors
      '--accent-pink': rgbToHex(...pr),
      '--accent-rose': rgbToHex(...sr),
      '--accent-blush': rgbToHex(...mr),
      '--accent-warm': rgbToHex(...wr),

      // Glass morphism
      '--glass-bg': `rgba(${pr[0]}, ${pr[1]}, ${pr[2]}, 0.06)`,
      '--glass-bg-hover': `rgba(${pr[0]}, ${pr[1]}, ${pr[2]}, 0.12)`,
      '--glass-bg-active': `rgba(${pr[0]}, ${pr[1]}, ${pr[2]}, 0.14)`,
      '--glass-border': `rgba(${mr[0]}, ${mr[1]}, ${mr[2]}, 0.18)`,
      '--glass-border-hover': `rgba(${mr[0]}, ${mr[1]}, ${mr[2]}, 0.3)`,
      '--glass-shadow': `rgba(${sr[0]}, ${sr[1]}, ${sr[2]}, 0.05)`,

      // Glass card background — derived from darkest colors in image
      '--glass-card-bg': `rgba(${Math.round(darkHue/360*30)}, ${Math.round(darkSat/100*12)}, ${Math.round(darkHue/360*20)}, 0.35)`,

      // Sub-component glass
      '--glass-sub-bg': `rgba(${Math.round(darkHue/360*30)}, ${Math.round(darkSat/100*12)}, ${Math.round(darkHue/360*20)}, 0.35)`,
      '--glass-sub-border': `rgba(${mr[0]}, ${mr[1]}, ${mr[2]}, 0.18)`,

      // Text (keep white-based for readability but tint slightly)
      '--text-primary': `rgba(255, 255, 255, 0.95)`,
      '--text-secondary': `rgba(${Math.min(255, mr[0]+60)}, ${Math.min(255, mr[1]+60)}, ${Math.min(255, mr[2]+60)}, 0.7)`,
      '--text-muted': `rgba(${Math.min(255, mr[0]+40)}, ${Math.min(255, mr[1]+40)}, ${Math.min(255, mr[2]+40)}, 0.45)`,

      // Scrollbar
      '--scrollbar-color': `rgba(${pr[0]}, ${pr[1]}, ${pr[2]}, 0.3)`,
      '--scrollbar-hover': `rgba(${pr[0]}, ${pr[1]}, ${pr[2]}, 0.5)`,

      // Sidebar
      '--sidebar-bg': `rgba(${sr[0]}, ${sr[1]}, ${sr[2]}, 0.1)`,
      '--sidebar-border': `rgba(${mr[0]}, ${mr[1]}, ${mr[2]}, 0.15)`,

      // Body overlay
      '--overlay-color': `rgba(${Math.round(darkHue/360*15)}, ${Math.round(darkSat/100*5)}, ${Math.round(darkHue/360*10)}, 0.45)`,
      '--overlay-glow1': `rgba(${sr[0]}, ${sr[1]}, ${sr[2]}, 0.08)`,
      '--overlay-glow2': `rgba(${pr[0]}, ${pr[1]}, ${pr[2]}, 0.05)`,
      '--overlay-glow3': `rgba(${Math.round(darkHue/360*100)}, ${Math.round(darkSat/100*20)}, ${Math.round(darkHue/360*60)}, 0.06)`,

      // RGB values for rgba() usage in component CSS
      '--accent-primary-rgb': `${pr[0]}, ${pr[1]}, ${pr[2]}`,
      '--accent-secondary-rgb': `${sr[0]}, ${sr[1]}, ${sr[2]}`,
      '--accent-muted-rgb': `${mr[0]}, ${mr[1]}, ${mr[2]}`,
      '--accent-warm-rgb': `${wr[0]}, ${wr[1]}, ${wr[2]}`,
    };
  }

  // ─── Apply Theme ───
  // Strict palette key + value validation. The palette is persisted via
  // store.set('theme') and reloaded on every launch — without validation,
  // a poisoned palette value (e.g. via store.set XSS path) could inject
  // arbitrary CSS via setProperty (which doesn't sanitize). Allowlist:
  //   • keys must look like CSS custom properties (`--word-stuff`)
  //   • values must be a small known shape: rgb()/rgba() / hex / a small
  //     unit number / a single CSS keyword. Anything else is dropped.
  const PALETTE_KEY_RE = /^--[a-z][a-z0-9-]{1,40}$/i;
  const PALETTE_VALUE_RE =
    /^(rgba?\(\s*[\d.\s,%/]+\s*\)|#[0-9a-f]{3,8}|[a-z]+|[\d.]+(?:px|em|rem|%|deg)?|[\d., ]+)$/i;
  function _isSafePaletteEntry(key, value) {
    if (typeof key !== 'string' || !PALETTE_KEY_RE.test(key)) return false;
    const v = String(value == null ? '' : value).trim();
    if (v.length === 0 || v.length > 200) return false;
    return PALETTE_VALUE_RE.test(v);
  }

  function applyPalette(vars) {
    const root = document.documentElement;
    let dropped = 0;
    Object.entries(vars).forEach(([key, value]) => {
      if (!_isSafePaletteEntry(key, value)) { dropped++; return; }
      root.style.setProperty(key, value);
    });
    if (dropped > 0) {
      // eslint-disable-next-line no-console
      console.warn(`theme-engine: dropped ${dropped} unsafe palette entries`);
    }
  }

  // CSS url() value escape. backslashes → forward slashes (Windows paths),
  // then percent-encode any character that could break out of the literal.
  // We always wrap in DOUBLE quotes so internal single quotes are safe; we
  // still escape `"` defensively.
  function _safeCssUrl(rawPath) {
    return String(rawPath || '')
      .replace(/\\/g, '/')
      .replace(/"/g, '%22')
      .replace(/\)/g, '%29')
      .replace(/\n/g, '');
  }

  async function applyTheme(imagePath) {
    // Set background image
    document.body.style.backgroundImage = `url("${_safeCssUrl(imagePath)}")`;

    // Extract colors and apply
    const palette = await extractColors(imagePath);
    applyPalette(palette);

    // Save to store
    if (window.electronAPI) {
      await window.electronAPI.store.set('theme', {
        imagePath,
        palette,
        timestamp: Date.now()
      });
    }
  }

  async function applyPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    // Get the absolute path via IPC
    let imagePath;
    if (window.electronAPI) {
      imagePath = await window.electronAPI.theme.getPresetPath(preset.file);
    } else {
      imagePath = `assets/images/backgrounds/${preset.file}`;
    }

    document.body.style.backgroundImage = `url("${_safeCssUrl(imagePath)}")`;

    const palette = await extractColors(imagePath);
    applyPalette(palette);

    if (window.electronAPI) {
      await window.electronAPI.store.set('theme', {
        preset: presetKey,
        imagePath,
        palette,
        timestamp: Date.now()
      });
    }
  }

  async function applyCustomImage(customTheme) {
    // customTheme = { id, path, name } from IPC
    const filePath = customTheme.path || customTheme;
    const cssUrl = `file://${_safeCssUrl(filePath)}`;
    document.body.style.backgroundImage = `url("${cssUrl}")`;

    const palette = await extractColors(cssUrl);
    applyPalette(palette);

    if (window.electronAPI) {
      await window.electronAPI.store.set('theme', {
        customId: customTheme.id || null,
        customPath: filePath,
        palette,
        timestamp: Date.now()
      });
    }
  }

  async function loadSavedTheme() {
    if (!window.electronAPI) return;

    try {
      const theme = await window.electronAPI.store.get('theme');
      if (!theme) return; // Use default CSS

      // Restore palette immediately (fast — no image loading needed)
      if (theme.palette) {
        applyPalette(theme.palette);
      }

      // Restore background image — every URL value flows through _safeCssUrl
      // so a poisoned `customPath` / `imagePath` in the persisted store can't
      // break out of the url() literal and inject arbitrary CSS.
      if (theme.customPath) {
        document.body.style.backgroundImage = `url("file://${_safeCssUrl(theme.customPath)}")`;
      } else if (theme.preset) {
        const preset = PRESETS[theme.preset];
        if (preset) {
          const imagePath = await window.electronAPI.theme.getPresetPath(preset.file);
          document.body.style.backgroundImage = `url("${_safeCssUrl(imagePath)}")`;
        }
      } else if (theme.imagePath) {
        document.body.style.backgroundImage = `url("${_safeCssUrl(theme.imagePath)}")`;
      }
    } catch (err) {
      console.warn('Failed to load saved theme:', err);
    }
  }

  return { PRESETS, applyTheme, applyPreset, applyCustomImage, loadSavedTheme, extractColors };
})();
