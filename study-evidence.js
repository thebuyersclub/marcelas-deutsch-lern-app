/* Beobachtet nur bewertete Aufgaben, nicht das Öffnen oder Überspringen. */
(function(){'use strict';
 const seen=new WeakMap();
 function capture(ok,modeOverride){
  if(typeof _cache==='undefined'||!_cache||typeof _pQ==='undefined'||!Array.isArray(_pQ))return;
  const user=window.marcelaAuth?.user();if(!user?.uid||!user.verified)return;
  const item=_pQ[_pI];if(!item)return;
  let indices=seen.get(_pQ);if(!indices){indices=new Set();seen.set(_pQ,indices);}if(indices.has(_pI))return;
  const event=window.marcelaEvidence.observe({item,chapterId:item._chapterId||item.chId||_curChId,mode:modeOverride||_pMode,correct:!!ok,id:crypto.randomUUID()});
  if(!event)return;indices.add(_pI);
  _cache.learningEvidence=window.marcelaEvidence.merge({[event.id]:event},_cache.learningEvidence);
 }
 for(const name of ['fcResult','showFeedback']){
  const original=window[name];if(typeof original!=='function')continue;
  window[name]=function(ok){capture(ok,name==='fcResult'?'flashcard':null);const value=original.apply(this,arguments);if(typeof _cache!=='undefined'&&_cache)window.save(_cache);return value;};
 }
})();
