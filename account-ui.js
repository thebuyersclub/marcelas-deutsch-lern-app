(function(){
  'use strict';
  function install(){
    const user=window.marcelaAuth.user();if(!user?.verified||document.getElementById('account-tools'))return;
    const box=document.createElement('div');box.id='account-tools';
    box.style.cssText='margin:12px auto;padding:12px;max-width:680px;background:#fff;border-radius:14px;font-family:Nunito,system-ui';
    if(user.role==='admin'){
      const label=document.createElement('label');label.textContent='Gesicherte Lerninhalte in die leere Testdatenbank übernehmen: ';
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.id='backup-import';
      input.addEventListener('change',async()=>{
        if(!input.files[0])return;input.disabled=true;
        try{await window.marcelaData.importBackup(JSON.parse(await input.files[0].text()));window.marcelaData.status('Lerninhalte übertragen und mit der Sicherung verglichen.');}
        catch(error){window.marcelaData.status(error.message,true);}
        finally{input.disabled=false;input.value='';}
      });
      label.append(input);box.append(label);document.getElementById('home').querySelector('.scroll').append(box);
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
