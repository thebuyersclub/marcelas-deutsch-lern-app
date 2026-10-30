(function(){
  'use strict';
  function install(){
    const user=window.marcelaAuth.user();if(!user?.verified||document.getElementById('account-tools'))return;
    const box=document.createElement('div');box.id='account-tools';
    box.style.cssText='margin:12px auto;padding:12px;max-width:680px;background:#fff;border-radius:14px;font-family:Nunito,system-ui';
    if(user.role==='admin'){
      const adminEntry=document.createElement('button');adminEntry.type='button';adminEntry.id='btn-admin';
      adminEntry.className='btn-primary';adminEntry.textContent='Verwaltung';
      adminEntry.style.cssText='margin-top:10px;background:var(--ink)';
      adminEntry.addEventListener('click',()=>{
        if(window.marcelaAuth.user()?.role==='admin')window.showView('home');
      });
      document.getElementById('btn-learn').after(adminEntry);
      const backup=document.createElement('button');backup.type='button';backup.textContent='Lerninhalte sichern';
      backup.addEventListener('click',async()=>{
        backup.disabled=true;
        try{
          const data=await window.marcelaData.exportContent();
          const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
          const link=document.createElement('a');link.href=url;link.download='marcela-lerninhalte-'+new Date().toISOString().slice(0,10)+'.json';link.click();
          setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(error){window.marcelaData.status(error.message,true);}
        finally{backup.disabled=false;}
      });box.append(backup);
      const retry=document.createElement('button');retry.type='button';retry.textContent='Speichern erneut versuchen';
      retry.addEventListener('click',async()=>{retry.disabled=true;try{await window.marcelaData.retryPending();}catch(error){window.marcelaData.status(error.message,true);}finally{retry.disabled=false;}});box.append(retry);
      const local=document.createElement('button');local.type='button';local.textContent='Lokale Änderungen sichern';
      local.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(window.marcelaData.localBackup(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='marcela-lokale-aenderungen.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});box.append(local);
      const maintenance=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Bisherige Inhalte prüfen';maintenance.append(summary);
      const label=document.createElement('label');label.textContent=window.MARCELA_CONFIG.environment==='production'?'Sicherungsdatei der bisherigen App auswählen: ':'Gesicherte Lerninhalte in die leere Testdatenbank übernehmen: ';
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.id='backup-import';
      input.addEventListener('change',async()=>{
        if(!input.files[0])return;input.disabled=true;
        try{
          const data=JSON.parse(await input.files[0].text());
          if(window.MARCELA_CONFIG.environment==='production')await window.marcelaData.verifyAndArchive(data);
          else{await window.marcelaData.importBackup(data);window.marcelaData.status('Lerninhalte übertragen und mit der Sicherung verglichen.');}
        }
        catch(error){window.marcelaData.status(error.message,true);}
        finally{input.disabled=false;input.value='';}
      });
      label.append(input);maintenance.append(label);box.append(maintenance);document.getElementById('home').querySelector('.scroll').append(box);
      const packageDetails=document.createElement('details'),packageSummary=document.createElement('summary');
      packageSummary.textContent='Sonderkapitel hinzufügen';packageDetails.append(packageSummary);
      const packageLabel=document.createElement('label');packageLabel.textContent='Vorbereitetes Kapitelpaket auswählen: ';
      const packageInput=document.createElement('input');packageInput.type='file';packageInput.accept='.json,application/json';
      const preview=document.createElement('p'),importButton=document.createElement('button');
      importButton.type='button';importButton.textContent='Sonderkapitel jetzt hinzufügen';importButton.disabled=true;
      let preparedPackage=null;
      packageInput.addEventListener('change',async()=>{
        preparedPackage=null;importButton.disabled=true;preview.textContent='';
        try{
          if(!packageInput.files[0])return;
          const data=JSON.parse(await packageInput.files[0].text());
          if(data.format!=='marcela-chapter-package-v1'||!Array.isArray(data.chapters)||!data.chapters.length)throw new Error('Bitte ein gültiges Kapitelpaket auswählen.');
          preparedPackage=data;preview.textContent=data.title+' · '+data.chapters.length+' Unterkapitel. Bestehende Kapitel werden erhalten. Vorher wird eine Sicherung heruntergeladen.';importButton.disabled=false;
        }catch(error){preview.textContent=error.message;}
      });
      importButton.addEventListener('click',async()=>{
        if(!preparedPackage)return;importButton.disabled=true;packageInput.disabled=true;
        try{
          const backupData=await window.marcelaData.exportContent();
          const url=URL.createObjectURL(new Blob([JSON.stringify(backupData,null,2)],{type:'application/json'}));
          const link=document.createElement('a');link.href=url;link.download='marcela-vor-sonderkapitel-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
          await window.marcelaData.appendChapterPackage(preparedPackage);preview.textContent='Sonderkapitel erfolgreich hinzugefügt und online geprüft.';preparedPackage=null;
        }catch(error){preview.textContent=error.message;window.marcelaData.status(error.message,true);importButton.disabled=false;}
        finally{packageInput.disabled=false;}
      });
      packageLabel.append(packageInput);packageDetails.append(packageLabel,preview,importButton);box.append(packageDetails);
    }else{
      box.innerHTML='<details><summary>Wort oder Satz hinzufügen</summary><form style="display:grid;gap:10px;margin-top:12px"><label>Art <select name="type"><option value="vocab">Wort</option><option value="sentence">Satz</option></select></label><label>Deutsch <input name="de" required maxlength="2000"></label><label>Tschechisch <input name="cz" required maxlength="2000"></label><label>Beispiel <input name="example" maxlength="4000"></label><button type="submit">Hinzufügen</button><p role="status"></p></form></details>';
      const form=box.querySelector('form');form.addEventListener('submit',async event=>{
        event.preventDefault();const button=form.querySelector('button');button.disabled=true;
        try{await window.marcelaData.addEntry(form.elements.type.value,form.elements.de.value,form.elements.cz.value,form.elements.example.value);form.reset();form.querySelector('[role=status]').textContent='Hinzugefügt. Du findest den Eintrag unter „Eigene Wörter und Sätze“.';window.renderLearnList();}
        catch(error){form.querySelector('[role=status]').textContent=error.message;}
        finally{button.disabled=false;}
      });document.getElementById('learn-home').querySelector('.scroll').append(box);
    }
  }
  const originalShow=window.showView;
  window.showView=function(id){
    const user=window.marcelaAuth.user();
    if(user?.role==='learner'&&['home','chapter-detail','new-chapter'].includes(id))id='learn-home';
    const result=originalShow(id);install();return result;
  };
  // Die Eigene-Ergänzungen-Sammlung wird für Admins außerhalb der Kapitelverwaltung angezeigt.
  const originalRender=window.renderAdminList;
  window.renderAdminList=function(){
    const all=_cache.chapters;
    try{_cache.chapters=all.filter(ch=>!ch._dictionaryAdditions);return originalRender();}
    finally{_cache.chapters=all;}
  };
})();
