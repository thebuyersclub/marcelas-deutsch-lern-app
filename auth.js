/* Firebase-Anmeldung. Kein Passwortspeicher; optionale Anmeldung für höchstens 30 Tage. */
(function () {
  'use strict';
  let session = null;
  let refreshing = null;
  let pendingLogin = null;
  let restoring = null;
  const rememberDuration = 30 * 24 * 60 * 60 * 1000;
  const store = window.marcelaSessionStore;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('marcela-test-auth-' + window.MARCELA_CONFIG?.firebaseProjectId) : null;
  async function persist(current) {
    if (current !== session || !current.rememberUntil) return;
    await store.write({uid:current.uid, email:current.email, refreshToken:current.refreshToken,
      rememberUntil:current.rememberUntil, projectId:config().firebaseProjectId});
  }
  async function signOut(broadcast = true) {
    session = null;
    // Sperrt die sichtbare App sofort, auch wenn das Löschen des Speichers fehlschlägt.
    document.body.style.visibility = 'hidden';
    try {
      await store.clear();
      if (broadcast) channel?.postMessage('logout');
      window.location.reload();
    } catch (_) {
      document.body.style.visibility = 'visible';
      document.body.replaceChildren();
      const notice = document.createElement('p');
      notice.textContent = 'Abmeldung konnte nicht vollständig gespeichert werden. Bitte die Website-Daten für diese App im Browser löschen und das Fenster schließen.';
      document.body.append(notice);
    }
  }
  if(channel) channel.onmessage = event => {if(event.data === 'logout') void signOut(false);};
  function showAccountControls() {
    if(document.getElementById('marcela-signout')) return;
    const button=document.createElement('button');
    button.id='marcela-signout'; button.type='button'; button.textContent='Abmelden';
    button.style.cssText='position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);right:12px;z-index:10000;background:#fff;color:#007AFF;border:1px solid #d1d1d6;border-radius:12px;padding:8px 12px;font:700 14px Nunito,system-ui,sans-serif';
    button.addEventListener('click',()=>void signOut());
    document.body.append(button);
  }
  async function restore() {
    if(session) return;
    if(!restoring) restoring=(async()=>{
      let saved;
      try {saved=await store.read();} catch (_) {return;}
      if(!saved) return;
      if(saved.projectId!==config().firebaseProjectId || !roleFor(saved.uid,saved.email)
          || typeof saved.refreshToken!=='string' || !Number.isFinite(saved.rememberUntil)
          || saved.rememberUntil<=Date.now() || saved.rememberUntil>Date.now()+rememberDuration) {
        await store.clear(); return;
      }
      session={uid:saved.uid,email:saved.email,role:roleFor(saved.uid,saved.email),verified:false,
        refreshToken:saved.refreshToken,rememberUntil:saved.rememberUntil,expiresAt:0};
      try {
        const data=await api('lookup',{idToken:await token()});
        const user=(data.users||[]).find(u=>u.localId===saved.uid);
        if(!user || user.disabled || roleFor(user.localId,user.email)!==session.role) throw new Error('Konto nicht freigegeben');
        session.verified=user.emailVerified===true;
      } catch (_) {session=null;await store.clear();}
    })().finally(()=>{restoring=null;});
    await restoring;
  }
  const accounts = Object.freeze({
    'pNj7pvNO9GdiOKBujyKhbL4VxWK2': {email:'deutschadmin@thekoch.org', role:'admin'},
    '1MPycSV12USFHcf8amSctuCfKKY2': {email:'lernen@thekoch.org', role:'learner'}
  });
  const config = () => window.MARCELA_CONFIG || {};
  function roleFor(uid, email) {
    const account = accounts[uid];
    return account && account.email === email ? account.role : null;
  }
  async function api(action, body) {
    if (!window.marcelaTestEnvironment.ready()) throw new Error('Die Testumgebung ist noch nicht eingerichtet.');
    const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:' + action + '?key=' + encodeURIComponent(config().firebaseApiKey), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body), signal:AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error('Die Anmeldung oder Bestätigung ist fehlgeschlagen. Bitte Angaben und Internetverbindung prüfen.');
    return result;
  }
  async function token() {
    if (!session) throw new Error('Bitte zuerst anmelden.');
    if (session.rememberUntil && Date.now() >= session.rememberUntil) {
      await signOut();
      throw new Error('Die 30 Tage sind abgelaufen. Bitte erneut anmelden.');
    }
    if (Date.now() < session.expiresAt - 60000) return session.idToken;
    if (!refreshing) {
      refreshing = (async () => {
        const current = session;
        const response = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(config().firebaseApiKey), {
          method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({grant_type:'refresh_token', refresh_token:current.refreshToken}),
          signal:AbortSignal.timeout(15000)
        });
        const data = await response.json();
        if (!response.ok || data.user_id !== current.uid || session !== current) {
          session = null;
          throw new Error('Die Sitzung ist abgelaufen. Bitte die Seite neu öffnen und anmelden.');
        }
        current.idToken = data.id_token;
        current.refreshToken = data.refresh_token;
        current.expiresAt = Date.now() + Number(data.expires_in) * 1000;
        await persist(current);
        return current.idToken;
      })().finally(() => {refreshing = null;});
    }
    return refreshing;
  }
  async function signIn(email, password, remember) {
    const data = await api('signInWithPassword', {email, password, returnSecureToken:true});
    const role = roleFor(data.localId, data.email);
    if (!role) throw new Error('Dieses Konto ist für die Lern-App nicht freigegeben.');
    const profile = await api('lookup', {idToken:data.idToken});
    const user = (profile.users || []).find(u => u.localId === data.localId);
    if (!user || user.disabled || roleFor(user.localId, user.email) !== role) throw new Error('Dieses Konto ist nicht freigegeben.');
    await store.clear();
    session = {rememberUntil:remember ? Date.now()+rememberDuration : 0, uid:data.localId, email:data.email, role, verified:user.emailVerified === true,
      idToken:data.idToken, refreshToken:data.refreshToken, expiresAt:Date.now() + Number(data.expiresIn) * 1000};
    try {await persist(session);} catch (_) {session.rememberUntil=0;}
    return publicUser();
  }
  function publicUser() {
    return session ? Object.freeze({uid:session.uid, email:session.email, role:session.role, verified:session.verified}) : null;
  }
  async function confirmEmail() {
    if (!session) throw new Error('Bitte zuerst anmelden.');
    await api('sendOobCode', {requestType:'VERIFY_EMAIL', idToken:await token()});
  }
  async function refreshVerification() {
    if (!session) throw new Error('Bitte zuerst anmelden.');
    const current = session;
    const data = await api('lookup', {idToken:await token()});
    const user = (data.users || []).find(u => u.localId === current.uid);
    if (!user || !user.emailVerified || roleFor(user.localId, user.email) !== current.role) return false;
    current.expiresAt = 0;
    await token();
    current.verified = true;
    return true;
  }
  async function ensureUser() {
    await restore();
    if (session?.verified) {showAccountControls();return publicUser();}
    if (pendingLogin) return pendingLogin;
    pendingLogin = new Promise(resolve => {
      const panel = document.createElement('section');
      panel.id = 'marcela-login';
      panel.setAttribute('aria-label','Anmeldung zur Lern-App');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#F2F2F7;display:grid;place-items:center;padding:24px;overflow:auto;font-family:Nunito,system-ui,sans-serif';
      panel.innerHTML = `<form style="box-sizing:border-box;background:white;border-radius:24px;padding:28px;width:100%;max-width:420px;color:#1C1C1E;box-shadow:0 8px 32px #0001">
        <h1 style="margin-top:0">Marcela · Deutsch lernen</h1><p>Willkommen! Melde dich mit deinem Lern- oder Administrationskonto an.</p>
        <label style="display:block">E-Mail<input name="email" type="email" autocomplete="username" required style="box-sizing:border-box;display:block;width:100%;padding:12px;margin:8px 0 16px;border:1px solid #aaa;border-radius:10px;font:inherit"></label>
        <label style="display:block">Passwort<input name="password" type="password" autocomplete="current-password" required style="box-sizing:border-box;display:block;width:100%;padding:12px;margin:8px 0 16px;border:1px solid #aaa;border-radius:10px;font:inherit"></label>
        <label style="display:flex;gap:10px;align-items:center;margin-bottom:18px"><input name="remember" type="checkbox">30 Tage angemeldet bleiben</label>
        <button type="submit" style="width:100%;padding:13px;border:0;border-radius:12px;background:#007AFF;color:white;font:inherit;font-weight:800">Anmelden</button>
        <p role="status" aria-live="polite"></p>
        <div data-verification hidden><button type="button" data-send>Bestätigungs-E-Mail senden</button> <button type="button" data-check>Bestätigung prüfen</button></div>
      </form>`;
      const form=panel.querySelector('form'), status=form.querySelector('[role=status]');
      const submit=form.querySelector('[type=submit]');
      const finish=()=>{if(session?.verified){panel.remove();showAccountControls();resolve(publicUser());}};
      form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled=true; status.textContent='Anmeldung wird geprüft …';
        try {
          await signIn(form.elements.email.value.trim(), form.elements.password.value, form.elements.remember.checked);
          form.elements.password.value='';
          if (session.verified) finish();
          else {status.textContent='Bitte bestätige zuerst deine E-Mail-Adresse. Du kannst dir hier eine Bestätigung senden lassen.'; form.querySelector('[data-verification]').hidden=false;}
        } catch (error) {form.elements.password.value=''; status.textContent=error.message;}
        finally {submit.disabled=false;}
      });
      form.querySelector('[data-send]').addEventListener('click', async event => {
        event.target.disabled=true;
        try {await confirmEmail();status.textContent='Bestätigungs-E-Mail gesendet. Öffne den Link in deinem Postfach und klicke danach auf „Bestätigung prüfen“.';}
        catch(error) {status.textContent=error.message;}
        finally {event.target.disabled=false;}
      });
      form.querySelector('[data-check]').addEventListener('click', async event => {
        event.target.disabled=true;
        try {if(await refreshVerification())finish();else status.textContent='Die E-Mail-Adresse ist noch nicht bestätigt.';}
        catch(error) {status.textContent=error.message;}
        finally {event.target.disabled=false;}
      });
      document.body.append(panel);
    }).finally(()=>{pendingLogin=null;});
    return pendingLogin;
  }
  window.marcelaAuth = Object.freeze({ensureUser, token, user:publicUser, roleFor,
    async headers() {return {Authorization:'Bearer ' + await token()};},
    signOut
  });
})();
