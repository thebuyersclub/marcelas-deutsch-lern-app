/* Normalisierte Tabellen und die vorhandene Oberfläche verwenden dieselben Kennungen. */
(function(root){
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v));
  function canonical(v){return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
  const maps={chapters:{id:'id',name:'title',desc:'description'},vocabulary:{id:'id',lessonName:'lesson_name',de:'german',cz:'czech',example:'example'},sentences:{id:'id',lessonName:'lesson_name',de:'german',cz:'czech'},grammar_notes:{id:'id',lessonName:'lesson_name',title:'title',text:'body'},grammar_tables:{id:'id',lessonName:'lesson_name',title:'title',rows:'row_count',cols:'column_count'},grammar_table_cells:{kind:'kind',text:'prompt',answer:'answer'}};
  const fields={vocab:'vocabulary',sentences:'sentences',grammar:'grammar_notes',grammarTables:'grammar_tables',lessons:'exercises'};
  const active=r=>!r.extra?.sheet_archived&&!r.extra?.app_archived&&!r.content?._app_archived;
  const key=(t,r)=>JSON.stringify([t,...(t==='chapters'?['id']:t==='grammar_table_cells'?['chapter_id','table_id','row_index','column_index']:['chapter_id','id']).map(k=>r[k])]);
  function decode(t,r){const extra=clone(r.extra||{});delete extra.__migration_source_fields;delete extra.app_archived;delete extra.sheet_archived;for(const [k,v] of Object.entries(maps[t]))extra[k]=r[v];return extra;}
  function chapters(db){
    return (db.chapters||[]).filter(active).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).map(r=>{
      const ch=decode('chapters',r);
      for(const [field,t] of Object.entries(fields)){
        ch[field]=(db[t]||[]).filter(x=>x.chapter_id===r.id&&active(x)).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).map(x=>{
          if(t==='exercises')return {...clone(x.content),id:x.id,type:x.kind,lessonName:x.lesson_name};
          const item=decode(t,x);
          if(t==='grammar_tables')item.cells=(db.grammar_table_cells||[]).filter(c=>c.chapter_id===r.id&&c.table_id===x.id&&c.row_index<x.row_count&&c.column_index<x.column_count).sort((a,b)=>a.row_index-b.row_index||a.column_index-b.column_index).map(c=>decode('grammar_table_cells',c));
          return item;
        });
      }
      return ch;
    });
  }
  function changes(db,incoming){
    const desired=new Map(),original=new Map();
    for(const t of ['chapters',...Object.values(fields),'grammar_table_cells'])for(const r of db[t]||[])original.set(key(t,r),r);
    function encode(t,item,defaults){
      const k=key(t,{...defaults,id:item.id}),old=original.get(k),row={...clone(old||{}),...defaults};
      if(t==='exercises'){row.id=item.id;row.kind=item.type;row.lesson_name=item.lessonName||'Standard';row.content=clone(item);delete row.content._app_archived;}
      else {
        const map=maps[t];row.extra={...clone(old?.extra||{})};delete row.extra.app_archived;
        for(const [k,v] of Object.entries(item))if(!Object.hasOwn(map,k)&&!['cells','vocab','sentences','grammar','grammarTables','lessons'].includes(k))row.extra[k]=clone(v);
        for(const [k,v] of Object.entries(map))row[v]=item[k]??(k==='lessonName'?'Standard':'');
        if(old?.extra?.__migration_source_fields)row.extra.__migration_source_fields=old.extra.__migration_source_fields;
      }
      delete row.revision;delete row.updated_at;desired.set(k,{table:t,row,expected:old||null});return row;
    }
    function positions(t,items,chapter){
      const old=(db[t]||[]).filter(r=>active(r)&&(chapter===undefined||r.chapter_id===chapter)).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id));
      const present=new Set(items.map(x=>x.id)),known=new Set(old.map(x=>x.id));
      const unchanged=canonical(old.filter(x=>present.has(x.id)).map(x=>x.id))===canonical(items.filter(x=>known.has(x.id)).map(x=>x.id));
      let next=Math.max(-1,...(db[t]||[]).filter(r=>chapter===undefined||r.chapter_id===chapter).map(x=>x.position));
      return items.map((x,i)=>unchanged?(old.find(o=>o.id===x.id)?.position??++next):i);
    }
    const chapterPositions=positions('chapters',incoming);
    const ids=new Set();
    incoming.forEach((ch,pos)=>{
      if(!ch.id||ids.has(ch.id)||!ch.name?.trim())throw new Error('Ungültige oder doppelte Kapitelkennung.');ids.add(ch.id);
      encode('chapters',ch,{position:chapterPositions[pos]});
      for(const [field,t] of Object.entries(fields)){
        const seen=new Set(),order=positions(t,ch[field]||[],ch.id);(ch[field]||[]).forEach((item,p)=>{
          if(!item.id||seen.has(item.id))throw new Error('Ungültige oder doppelte Eintragskennung.');seen.add(item.id);
          encode(t,item,{chapter_id:ch.id,position:order[p]});
          if(t==='grammar_tables'){
            if(item.cells?.length!==item.rows*item.cols)throw new Error('Grammatik-Tabelle ist unvollständig.');
            item.cells.forEach((cell,i)=>encode('grammar_table_cells',cell,{chapter_id:ch.id,table_id:item.id,row_index:Math.floor(i/item.cols),column_index:i%item.cols}));
          }
        });
      }
    });
    // Entfernte Einträge bleiben rückholbar; sie werden nur aus der App ausgeblendet.
    for(const [k,old] of original){
      if(desired.has(k)||!active(old))continue;const t=JSON.parse(k)[0];
      if(t==='grammar_table_cells')continue;
      const row=clone(old);delete row.revision;delete row.updated_at;
      if(t==='exercises')row.content._app_archived=true;else row.extra.app_archived=true;
      desired.set(k,{table:t,row,expected:old});
    }
    return [...desired.values()].filter(c=>{const old=clone(c.expected);if(old){delete old.revision;delete old.updated_at;}return canonical(old)!==canonical(c.row);});
  }
  const api={chapters,changes,canonical,key};
  if(typeof module==='object')module.exports=api;else root.marcelaContent=Object.freeze(api);
})(typeof window==='object'?window:globalThis);
