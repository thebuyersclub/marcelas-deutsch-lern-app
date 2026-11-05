/* Gemeinsame Beobachtungen aus Studieren. Keine Antworten oder KI-Noten speichern. */
(function(root){'use strict';
 const LIMIT=500;
 function identity(item,chapterId){
  const kinds={vocab:'vocabulary',sentence:'sentences',order:'exercises',sentorder:'exercises',fill:'exercises',qa:'exercises',gtable:'grammar_tables',clock:'clock'};
  const table=kinds[item.ptype];if(!table||!chapterId)return null;
  if(item.ptype==='clock')return {chapterId,table,id:String(item.hours)+':'+String(item.minutes)};
  if(!item.id)return null;
  return {chapterId,table:item.ptype==='order'&&item.source_sentence_id?'sentences':table,id:item.source_sentence_id||item.id};
 }
 function dimension(item,mode){
  mode=item._lcMode||mode;
  if(mode==='weak')mode=item.mode||({vocab:'flashcard',sentence:'typing',order:'order',fill:'fill',qa:'qa',sentorder:'sentorder',gtable:'gtable',clock:'clock'}[item.ptype]);
  return {flashcard:'self_report',mc:'recognition',sentences:'self_report',typing:'writing',order:'word_order',sentorder:'sentence_order',fill:'gap',qa:'question',gtable:'grammar_table',clock:'clock'}[mode]||null;
 }
 // Version marker, not a cryptographic signature or security boundary.
 function fingerprint(item){
  const text=JSON.stringify([item.de||item.correct?.join?.(' ')||item.sentence||item.base||'',item.cz||item.czech_sentence||'',item.solution||'',item.options||[],item.cells||[],item.sentences||[]]);
  let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
 }
 function valid(e){return e&&e.version===1&&typeof e.id==='string'&&e.id.length<=100&&typeof e.chapterId==='string'&&typeof e.contentId==='string'&&typeof e.table==='string'&&typeof e.dimension==='string'&&typeof e.correct==='boolean'&&Number.isFinite(e.ts)&&typeof e.fingerprint==='string';}
 function merge(...ledgers){
  const map=new Map();for(const ledger of ledgers)for(const e of Object.values(ledger||{}))if(valid(e)&&!map.has(e.id))map.set(e.id,e);
  return Object.fromEntries([...map.values()].sort((a,b)=>b.ts-a.ts||a.id.localeCompare(b.id)).slice(0,LIMIT).map(e=>[e.id,e]));
 }
 function observe({item,chapterId,mode,correct,id,ts=Date.now()}){
  const source=identity(item,chapterId),skill=dimension(item,mode);if(!source||!skill||typeof correct!=='boolean')return null;
  return {version:1,id,ts,chapterId:source.chapterId,table:source.table,contentId:source.id,dimension:skill,direction:item._dir||'cz-de',correct,fingerprint:fingerprint(item),origin:'study',assessment:skill==='self_report'?'self_report':'legacy_checker'};
 }
 function summarize(ledger,{chapterId,table,id,fingerprint:version}={}){
  const rows=Object.values(merge(ledger)).filter(e=>(!chapterId||e.chapterId===chapterId)&&(!table||e.table===table)&&(!id||e.contentId===id)&&(!version||e.fingerprint===version));
  const groups=new Map();for(const e of rows){const k=JSON.stringify([e.chapterId,e.table,e.contentId,e.dimension,e.direction,e.fingerprint]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
  return [...groups.values()].map(events=>{const latest=events[0],recent=events.slice(0,5),errors=recent.filter(e=>!e.correct).length;return {...latest,attempts:events.length,recentErrors:errors,signal:!latest.correct?(errors>=2?'repeated_difficulty':'check_again'):'recent_success'};});
 }
 const api={LIMIT,identity,dimension,fingerprint,observe,merge,summarize};if(typeof module==='object')module.exports=api;else root.marcelaEvidence=Object.freeze(api);
})(typeof window==='object'?window:globalThis);
