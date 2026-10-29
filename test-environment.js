(function () {
  'use strict';
  const config = window.MARCELA_CONFIG || {};
  function ready() {
    return ['test','production'].includes(config.environment) &&
      config.firebaseProjectId === 'marcela-deutsch-test' &&
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
      title.textContent = 'Datenbankverbindung wird vorbereitet';
      const text = document.createElement('p');
      text.textContent = 'Die freigegebene Datenbank ist noch nicht richtig konfiguriert. Bitte die Administration verständigen.';
      panel.append(title, text);
      document.body.append(panel);
    }
  });
})();
