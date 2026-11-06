/* Supabase-Anmeldung. Kein Passwortspeicher; optionale Anmeldung für höchstens 30 Tage. */
(function () {
  'use strict';
  let session = null;
  let refreshing = null;
  let pendingLogin = null;
  let restoring = null;
  const rememberDuration = 30 * 24 * 60 * 60 * 1000;
  const store = window.marcelaSessionStore;
  let restoreUnavailable = false;
  const rejectedSession = () => Object.assign(new Error('Konto oder Sitzung nicht mehr gültig.'), {discardRemembered:true});
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('marcela-test-auth-' + window.MARCELA_CONFIG?.supabaseProjectId) : null;
  async function persist(current) {
    if (current !== session || !current.rememberUntil) return;
    await store.write({uid:current.uid, email:current.email, refreshToken:current.refreshToken,
      rememberUntil:current.rememberUntil, projectId:config().supabaseProjectId});
  }
  async function signOut(broadcast = true) {
    const previous=session;
    session = null;
    document.body.style.visibility='hidden';
    if(previous?.idToken){try{await authRequest('logout?scope=local',{},previous.idToken);}catch(_){/* Lokale Abmeldung bleibt möglich. */}}
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
      restoreUnavailable=false;
      let saved;
      try {saved=await store.read();} catch (_) {return;}
      if(!saved) return;
      if(saved.projectId!==config().supabaseProjectId || !roleFor(saved.uid,saved.email)
          || typeof saved.refreshToken!=='string' || !Number.isFinite(saved.rememberUntil)
          || saved.rememberUntil<=Date.now() || saved.rememberUntil>Date.now()+rememberDuration) {
        await store.clear(); return;
      }
      session={uid:saved.uid,email:saved.email,role:roleFor(saved.uid,saved.email),verified:false,
        refreshToken:saved.refreshToken,rememberUntil:saved.rememberUntil,expiresAt:0};
      try {
        const data=await api('lookup',{idToken:await token()});
        const user=(data.users||[]).find(u=>u.localId===saved.uid);
        if(!user || user.disabled || roleFor(user.localId,user.email)!==session.role) throw rejectedSession();
        session.verified=user.emailVerified===true;
        await window.marcelaLegacyMigration.ensure();
      } catch (error) {
        session=null;
        if(error.discardRemembered)await store.clear();
        else restoreUnavailable=true;
      }
    })().finally(()=>{restoring=null;});
    await restoring;
  }
  const accounts = Object.freeze({
    'ab268c88-64e1-4bd9-ad76-764445c059e1': {email:'deutschadmin@thekoch.org', role:'admin'},
    'c67fe2c2-dfbf-461f-921f-496a52c8d465': {email:'lernen@thekoch.org', role:'learner'}
  });
  const config = () => window.MARCELA_CONFIG || {};
  function roleFor(uid, email) {
    const account = accounts[uid];
    return account && account.email === email ? account.role : null;
  }
  async function authRequest(path,body,bearer) {
    const response=await fetch(config().supabaseUrl+'/auth/v1/'+path,{
      method:body===undefined?'GET':'POST',headers:{apikey:config().supabasePublishableKey,
        'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    const result=response.status===204?{}:await response.json();
    if(!response.ok){
      const code=result.error_code||result.code;
      if((path==='user'&&[401,403].includes(response.status))||
       (path==='token?grant_type=refresh_token'&&['refresh_token_not_found','refresh_token_already_used','session_not_found','user_banned','user_not_found','invalid_grant'].includes(code||result.error)))
       throw rejectedSession();
      throw new Error('Anmeldung fehlgeschlagen. Bitte Zugangsdaten und Verbindung prüfen.');
    }
    return result;
  }
  async function api(action,body) {
    if(!window.marcelaTestEnvironment.ready())throw new Error('Datenbank nicht eingerichtet.');
    if(action==='signInWithPassword'){
      const d=await authRequest('token?grant_type=password',{email:body.email,password:body.password});
      return {localId:d.user.id,email:d.user.email,idToken:d.access_token,refreshToken:d.refresh_token,expiresIn:d.expires_in};
    }
    if(action==='lookup'){
      const u=await authRequest('user',undefined,body.idToken);
      const r=await fetch(config().supabaseUrl+'/rest/v1/account_roles?select=user_id,role&user_id=eq.'+encodeURIComponent(u.id),{
        headers:{apikey:config().supabasePublishableKey,Authorization:'Bearer '+body.idToken},signal:AbortSignal.timeout(15000)});
      const roles=await r.json();
      if(!r.ok||!Array.isArray(roles))throw new Error('Kontofreigabe konnte nicht geprüft werden.');
      if(roles.length!==1||roles[0].role!==roleFor(u.id,u.email))throw rejectedSession();
      return {users:[{localId:u.id,email:u.email,emailVerified:!!u.email_confirmed_at,disabled:!!u.banned_until&&Date.parse(u.banned_until)>Date.now()}]};
    }
    if(action==='sendOobCode')return authRequest('resend',{type:'signup',email:session.email});
    throw new Error('Unbekannte Anmeldung.');
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
        const refresh=async()=>{
          if(current.rememberUntil){
            const saved=await store.read();
            if(saved?.uid===current.uid&&saved.projectId===config().supabaseProjectId)current.refreshToken=saved.refreshToken;
          }
          const data=await authRequest('token?grant_type=refresh_token',{refresh_token:current.refreshToken});
          if(data.user?.id!==current.uid)throw rejectedSession();
          if(session!==current)throw new Error('Sitzung abgelaufen.');
          current.idToken=data.access_token;current.refreshToken=data.refresh_token;
          current.expiresAt=Date.now()+Number(data.expires_in)*1000;
          await persist(current);
          return current.idToken;
        };
        if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request('marcela-supabase-refresh',refresh);
        return refresh();
      })().finally(() => {refreshing = null;});
    }
    return refreshing;
  }
  async function signIn(email, password, remember, oldPassword) {
    const data = await api('signInWithPassword', {email, password, returnSecureToken:true});
    const role = roleFor(data.localId, data.email);
    if (!role) throw new Error('Dieses Konto ist für die Lern-App nicht freigegeben.');
    const profile = await api('lookup', {idToken:data.idToken});
    const user = (profile.users || []).find(u => u.localId === data.localId);
    if (!user || user.disabled || roleFor(user.localId, user.email) !== role) throw new Error('Dieses Konto ist nicht freigegeben.');
    await store.clear();
    session = {rememberUntil:remember ? Date.now()+rememberDuration : 0, uid:data.localId, email:data.email, role, verified:user.emailVerified === true,
      idToken:data.idToken, refreshToken:data.refreshToken, expiresAt:Date.now() + Number(data.expiresIn) * 1000};
    await window.marcelaLegacyMigration.ensure(oldPassword||password);
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
        <details><summary>Bisheriges Passwort (nur falls abweichend)</summary><input name="oldPassword" type="password" autocomplete="off" aria-label="Bisheriges App-Passwort"></details>
        <label style="display:flex;gap:10px;align-items:center;margin-bottom:18px"><input name="remember" type="checkbox">30 Tage angemeldet bleiben</label>
        <button type="submit" style="width:100%;padding:13px;border:0;border-radius:12px;background:#007AFF;color:white;font:inherit;font-weight:800">Anmelden</button>
        <p role="status" aria-live="polite"></p>
        <button type="button" data-retry-restore hidden>Gemerkte Anmeldung erneut versuchen</button>
        <div data-verification hidden><button type="button" data-send>Bestätigungs-E-Mail senden</button> <button type="button" data-check>Bestätigung prüfen</button></div>
      </form>`;
      const form=panel.querySelector('form'), status=form.querySelector('[role=status]');
      const submit=form.querySelector('[type=submit]');
      const finish=()=>{if(session?.verified){panel.remove();showAccountControls();resolve(publicUser());}};
      const retry=form.querySelector('[data-retry-restore]');
      if(restoreUnavailable){
        retry.hidden=false;
        status.textContent='Die Verbindung konnte nicht geprüft werden. Deine gemerkte Anmeldung bleibt gespeichert.';
      }
      retry.addEventListener('click',async()=>{
        retry.disabled=true;submit.disabled=true;
        try{
          await restore();
          if(session?.verified){finish();return;}
          retry.hidden=!restoreUnavailable;
          status.textContent=restoreUnavailable?'Die Verbindung ist noch nicht verfügbar.':'Bitte melde dich an.';
        }finally{retry.disabled=false;submit.disabled=false;}
      });
      form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled=true; status.textContent='Anmeldung wird geprüft …';
        try {
          await signIn(form.elements.email.value.trim(), form.elements.password.value, form.elements.remember.checked, form.elements.oldPassword.value);
          form.elements.password.value=''; form.elements.oldPassword.value='';
          if (session.verified) finish();
          else {status.textContent='Bitte bestätige zuerst deine E-Mail-Adresse. Du kannst dir hier eine Bestätigung senden lassen.'; form.querySelector('[data-verification]').hidden=false;}
        } catch (error) {session=null; await store.clear(); form.elements.password.value=''; form.elements.oldPassword.value=''; status.textContent=error.message;}
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
