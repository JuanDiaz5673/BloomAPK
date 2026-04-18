// ─── Custom Confirm Dialog ───
const Confirm = (() => {
  function show(message, title = 'Confirm') {
    return new Promise((resolve) => {
      // Overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn 0.15s ease;
      `;

      // Dialog
      const dialog = document.createElement('div');
      dialog.className = 'confirm-dialog';
      dialog.style.cssText = `
        background: var(--glass-card-bg, rgba(30,12,20,0.35));
        backdrop-filter: blur(44px) saturate(1.4);
        -webkit-backdrop-filter: blur(44px) saturate(1.4);
        border: 1px solid var(--glass-border, rgba(255,200,210,0.18));
        border-radius: 20px;
        padding: 28px;
        min-width: 320px; max-width: 420px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08);
        animation: fadeSlideUp 0.25s ease;
        position: relative;
        overflow: hidden;
      `;

      // Top gradient line
      const gradLine = document.createElement('div');
      gradLine.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0; height: 1px;
        background: linear-gradient(90deg, transparent, var(--glass-border-hover, rgba(255,160,180,0.3)), transparent);
      `;
      dialog.appendChild(gradLine);

      // Title
      const titleEl = document.createElement('div');
      titleEl.style.cssText = `
        font-family: 'Cormorant Garamond', serif;
        font-size: 20px; font-weight: 400;
        margin-bottom: 12px;
        background: linear-gradient(135deg, #fff 30%, var(--accent-blush, #fab1c4));
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
      `;
      titleEl.textContent = title;
      dialog.appendChild(titleEl);

      // Message
      const msgEl = document.createElement('div');
      msgEl.style.cssText = `
        font-family: 'Outfit', sans-serif;
        font-size: 13px; font-weight: 300;
        color: var(--text-secondary, rgba(255,235,240,0.7));
        line-height: 1.6;
        margin-bottom: 24px;
      `;
      msgEl.textContent = message;
      dialog.appendChild(msgEl);

      // Buttons
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = `
        padding: 9px 22px; border-radius: 10px;
        border: 1px solid var(--glass-border, rgba(255,150,180,0.15));
        background: rgba(var(--accent-primary-rgb, 255,107,157), 0.06);
        color: var(--text-secondary, rgba(255,235,240,0.7));
        font-family: 'Outfit', sans-serif;
        font-size: 12px; font-weight: 400;
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      cancelBtn.onmouseenter = () => { cancelBtn.style.background = 'rgba(var(--accent-primary-rgb, 255,107,157), 0.15)'; cancelBtn.style.color = 'var(--text-primary)'; };
      cancelBtn.onmouseleave = () => { cancelBtn.style.background = 'rgba(var(--accent-primary-rgb, 255,107,157), 0.06)'; cancelBtn.style.color = 'var(--text-secondary)'; };

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.style.cssText = `
        padding: 9px 22px; border-radius: 10px;
        border: none;
        background: linear-gradient(135deg, var(--accent-pink, #ff6b9d), var(--accent-rose, #e84393));
        color: white;
        font-family: 'Outfit', sans-serif;
        font-size: 12px; font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 16px rgba(var(--accent-primary-rgb, 255,107,157), 0.3);
        letter-spacing: 0.3px;
      `;
      confirmBtn.onmouseenter = () => { confirmBtn.style.filter = 'brightness(1.1)'; confirmBtn.style.transform = 'translateY(-1px)'; };
      confirmBtn.onmouseleave = () => { confirmBtn.style.filter = 'none'; confirmBtn.style.transform = 'none'; };

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(confirmBtn);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Define keyHandler BEFORE close so close() can remove it on EVERY
      // exit path (button click, backdrop click, Escape). The previous
      // version only removed the listener inside the Escape branch — every
      // other dismissal leaked the listener + the resolved promise's
      // closure, and over a long session each new dialog piled on more
      // ghost listeners that fired on subsequent Escape presses.
      const keyHandler = (e) => { if (e.key === 'Escape') close(false); };

      function close(result) {
        document.removeEventListener('keydown', keyHandler);
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s ease';
        setTimeout(() => overlay.remove(), 150);
        resolve(result);
      }

      cancelBtn.addEventListener('click', () => close(false));
      confirmBtn.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', keyHandler);

      // Focus confirm button
      confirmBtn.focus();
    });
  }

  function prompt(message, title = 'Input', placeholder = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn 0.15s ease;
      `;

      const dialog = document.createElement('div');
      dialog.className = 'confirm-dialog confirm-dialog--prompt';
      dialog.style.cssText = `
        background: var(--glass-card-bg, rgba(30,12,20,0.35));
        backdrop-filter: blur(44px) saturate(1.4);
        -webkit-backdrop-filter: blur(44px) saturate(1.4);
        border: 1px solid var(--glass-border, rgba(255,200,210,0.18));
        border-radius: 20px;
        padding: 28px;
        min-width: 360px; max-width: 440px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08);
        animation: fadeSlideUp 0.25s ease;
        position: relative; overflow: hidden;
      `;

      const gradLine = document.createElement('div');
      gradLine.style.cssText = `position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--glass-border-hover, rgba(255,160,180,0.3)), transparent);`;
      dialog.appendChild(gradLine);

      const titleEl = document.createElement('div');
      titleEl.style.cssText = `font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:400;margin-bottom:12px;background:linear-gradient(135deg,#fff 30%,var(--accent-blush,#fab1c4));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;`;
      titleEl.textContent = title;
      dialog.appendChild(titleEl);

      const msgEl = document.createElement('div');
      msgEl.style.cssText = `font-family:'Outfit',sans-serif;font-size:13px;font-weight:300;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;`;
      msgEl.textContent = message;
      dialog.appendChild(msgEl);

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder;
      input.style.cssText = `
        width: 100%; padding: 10px 14px; border-radius: 10px;
        background: rgba(var(--accent-primary-rgb, 255,107,157), 0.06);
        border: 1px solid var(--glass-border, rgba(255,150,180,0.15));
        font-family: 'Outfit', sans-serif; font-size: 13px; font-weight: 300;
        color: var(--text-primary, rgba(255,255,255,0.95)); outline: none;
        margin-bottom: 20px; box-sizing: border-box;
      `;
      input.addEventListener('focus', () => { input.style.borderColor = 'var(--accent-pink, #ff6b9d)'; });
      input.addEventListener('blur', () => { input.style.borderColor = 'var(--glass-border)'; });
      dialog.appendChild(input);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = `padding:9px 22px;border-radius:10px;border:1px solid var(--glass-border);background:rgba(var(--accent-primary-rgb,255,107,157),0.06);color:var(--text-secondary);font-family:'Outfit',sans-serif;font-size:12px;cursor:pointer;transition:all 0.2s;`;

      const createBtn = document.createElement('button');
      createBtn.textContent = 'Create';
      createBtn.style.cssText = `padding:9px 22px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--accent-pink,#ff6b9d),var(--accent-rose,#e84393));color:white;font-family:'Outfit',sans-serif;font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s;box-shadow:0 4px 16px rgba(var(--accent-primary-rgb,255,107,157),0.3);`;

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(createBtn);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // See Confirm.show — keyHandler defined before close() so close()
      // can unwind the document listener on every exit path, not just
      // on Escape. Without this, every prompt() call leaks one listener.
      const keyHandler = (e) => { if (e.key === 'Escape') close(null); };

      function close(value) {
        document.removeEventListener('keydown', keyHandler);
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s ease';
        setTimeout(() => overlay.remove(), 150);
        resolve(value);
      }

      cancelBtn.addEventListener('click', () => close(null));
      createBtn.addEventListener('click', () => close(input.value.trim() || null));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value.trim() || null); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      document.addEventListener('keydown', keyHandler);

      setTimeout(() => input.focus(), 100);
    });
  }

  return { show, prompt };
})();
