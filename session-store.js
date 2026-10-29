/* Nur bei ausdrücklich gewähltem „30 Tage angemeldet bleiben“. Kein Passwort. */
(function () {
  'use strict';
  const dbName = 'marcela-test-auth-' + (window.MARCELA_CONFIG?.firebaseProjectId || 'unconfigured');
  async function database() {
    return new Promise((resolve,reject) => {
      const request=indexedDB.open(dbName,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('session');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(new Error('Die Anmeldung kann in diesem Browser nicht gemerkt werden.'));
    });
  }
  async function transaction(mode, operation) {
    const db=await database();
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('session',mode);
        const request=operation(tx.objectStore('session'));
        let result;
        request.onsuccess=()=>{result=request.result;};
        tx.oncomplete=()=>resolve(result);
        tx.onerror=tx.onabort=()=>reject(new Error('Der Anmeldespeicher konnte nicht aktualisiert werden.'));
      });
    } finally {db.close();}
  }
  window.marcelaSessionStore=Object.freeze({
    read:()=>transaction('readonly',s=>s.get('remembered')),
    write:value=>transaction('readwrite',s=>s.put(value,'remembered')),
    clear:()=>transaction('readwrite',s=>s.delete('remembered'))
  });
})();
