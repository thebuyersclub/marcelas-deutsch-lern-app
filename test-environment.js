(function () {
  'use strict';
  const config = window.MARCELA_CONFIG || {};
  function ready() {
    return config.environment === 'test' &&
      /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.firebaseProjectId || '') &&
      config.firebaseProjectId !== 'marcela-deutsch' &&
      Boolean(config.firebaseApiKey);
  }
  window.marcelaTestEnvironment = Object.freeze({
    ready,
    explain() {
      if (ready()) return;
      const panel = document.createElement('div');
      panel.setAttribute('role', 'alert');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#F2F2F7;color:#1C1C1E;display:grid;place-content:center;padding:32px;font:18px/1.5 system-ui;text-align:center';
      const title = document.createElement('h1');
      title.textContent = 'Testversion wird vorbereitet';
      const text = document.createElement('p');
      text.textContent = 'Die separate Testdatenbank ist noch nicht verbunden. Eure bisherige App bleibt unverändert nutzbar.';
      panel.append(title, text);
      document.body.append(panel);
    }
  });
})();
