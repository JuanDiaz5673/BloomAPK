// ─── Internationalization Module ───
const I18n = (() => {
  const translations = {
    en: {
      // Nav
      // Users tab was removed from the sidebar; Profile is now reachable via
      // the header avatar. Study tab replaces it.
      nav_home: "Home", nav_study: "Study", nav_calendar: "Calendar",
      nav_chat: "Chat", nav_notes: "Notes", nav_files: "Files", nav_settings: "Settings",
      // Header
      greeting: "Welcome",
      subgreeting: "Here's what's happening across your workspace today",
      // Home
      welcome: "Welcome back",
      welcome_desc: "You have 3 pending tasks and 2 new messages. Your next meeting starts in 45 minutes.",
      tasks: "Tasks", events: "Events", files: "Files",
      activity: "Activity",
      act_files: "Project files updated", act_time1: "2 min ago",
      act_member: "New member added", act_time2: "28 min ago",
      act_meeting: "Meeting scheduled", act_time3: "1 hour ago",
      // AI
      ai_name: "Bloom Assistant",
      ai_status: "Online \u00b7 Ready to help",
      ai_tagline: "Your personal AI companion",
      chat1: "Hi there! How can I help you today? \u2728",
      chat2: "Can you summarize my tasks for the week?",
      chat3: "You have 12 tasks this week \u2014 3 are high priority. Your next deadline is the Design Brief review on Wednesday.",
      chat_placeholder: "Ask Bloom anything...",
      // Messages
      messages: "Messages",
      msg1: "Can you review the mockups?",
      msg2: "Retro notes are ready.",
      msg3: "Deployed to staging.",
      recent_files: "Recent Files",
      // Settings
      settings_title: "Settings",
      settings_google: "Google Account",
      settings_claude: "Claude API",
      settings_language: "Language",
      settings_about: "About",
      connect: "Connect",
      disconnect: "Disconnect",
      save: "Save",
      // General
      new_note: "New Note",
      open_chat: "Open full chat",
      no_events: "No upcoming events",
      no_notes: "No notes yet"
    },
    es: {
      nav_home: "Inicio", nav_study: "Estudio", nav_calendar: "Calendario",
      nav_chat: "Chat", nav_notes: "Notas", nav_files: "Archivos", nav_settings: "Ajustes",
      greeting: "Bienvenido",
      subgreeting: "Esto es lo que est\u00e1 pasando en tu espacio de trabajo hoy",
      welcome: "Bienvenido de nuevo",
      welcome_desc: "Tienes 3 tareas pendientes y 2 mensajes nuevos. Tu pr\u00f3xima reuni\u00f3n comienza en 45 minutos.",
      tasks: "Tareas", events: "Eventos", files: "Archivos",
      activity: "Actividad",
      act_files: "Archivos del proyecto actualizados", act_time1: "hace 2 min",
      act_member: "Nuevo miembro a\u00f1adido", act_time2: "hace 28 min",
      act_meeting: "Reuni\u00f3n programada", act_time3: "hace 1 hora",
      ai_name: "Asistente Bloom",
      ai_status: "En l\u00ednea \u00b7 Lista para ayudar",
      ai_tagline: "Tu compa\u00f1era personal de IA",
      chat1: "\u00a1Hola! \u00bfC\u00f3mo puedo ayudarte hoy? \u2728",
      chat2: "\u00bfPuedes resumir mis tareas de la semana?",
      chat3: "Tienes 12 tareas esta semana \u2014 3 son de alta prioridad. Tu pr\u00f3xima fecha l\u00edmite es la revisi\u00f3n del Brief de Dise\u00f1o el mi\u00e9rcoles.",
      chat_placeholder: "Preg\u00fantale algo a Bloom...",
      messages: "Mensajes",
      msg1: "\u00bfPuedes revisar los mockups?",
      msg2: "Las notas de la retro est\u00e1n listas.",
      msg3: "Desplegado en staging.",
      recent_files: "Archivos Recientes",
      settings_title: "Ajustes",
      settings_google: "Cuenta de Google",
      settings_claude: "API de Claude",
      settings_language: "Idioma",
      settings_about: "Acerca de",
      connect: "Conectar",
      disconnect: "Desconectar",
      save: "Guardar",
      new_note: "Nueva Nota",
      open_chat: "Abrir chat completo",
      no_events: "Sin eventos pr\u00f3ximos",
      no_notes: "A\u00fan no hay notas"
    }
  };

  let currentLang = 'en';

  function setLang(lang) {
    currentLang = lang;
    const t = translations[lang];
    if (!t) return;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (t[key]) el.placeholder = t[key];
    });

    // Update lang buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    // Persist
    if (window.electronAPI) {
      window.electronAPI.store.set('language', lang);
    }
  }

  function t(key) {
    return translations[currentLang]?.[key] || translations.en?.[key] || key;
  }

  function getLang() {
    return currentLang;
  }

  return { setLang, t, getLang };
})();
