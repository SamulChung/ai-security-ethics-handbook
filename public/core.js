(function(root){
'use strict';
const VERSION=1,KEY='ai-security-ethics-handbook-v1';
function escapeHTML(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeURL(value){try {const u=new URL(String(value));return /^https?:$/.test(u.protocol)?u.href:'';}catch(_){return '';}}
function safePDF(value){return typeof value==='string'&&/^(?:(?:papers|downloads)\/week-\d{2}|standards)\/[a-zA-Z0-9_.-]+\.pdf$/.test(value)?value:'';}
function normalizeText(value){return String(value==null?'':value).normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g,' ').trim();}
function emptyState(){return{version:VERSION,completed:[],bookmarks:[],notes:{},quiz:{},lastWeek:1};}
function isPlainObject(v){return !!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);}
function validId(s){return typeof s==='string'&&/^(week-(?:[1-9]|1[0-5])|w\d{2}-p\d{2})$/.test(s);}
function validateState(input){
 if(!isPlainObject(input)||input.version!==VERSION)throw Error('지원하지 않는 학습 기록 형식입니다.');
 const output=emptyState();
 for(const key of ['completed','bookmarks']){if(!Array.isArray(input[key])||input[key].length>300||input[key].some(v=>!validId(v)))throw Error('완료 표시 또는 북마크 형식이 올바르지 않습니다.');output[key]=[...new Set(input[key])];}
 if(!isPlainObject(input.notes)||Object.keys(input.notes).length>100)throw Error('노트 형식이 올바르지 않습니다.');
 for(const [k,v]of Object.entries(input.notes)){if(!validId(k)||typeof v!=='string'||v.length>30000)throw Error('유효하지 않은 노트가 포함되어 있습니다.');output.notes[k]=v;}
 if(!isPlainObject(input.quiz)||Object.keys(input.quiz).length>100)throw Error('퀴즈 기록 형식이 올바르지 않습니다.');
 for(const[k,v]of Object.entries(input.quiz)){if(!/^week-(?:[1-9]|1[0-5])-q\d{1,3}$/.test(k)||!Number.isInteger(v)||v<0||v>20)throw Error('유효하지 않은 퀴즈 결과가 포함되어 있습니다.');output.quiz[k]=v;}
 if(!Number.isInteger(input.lastWeek)||input.lastWeek<1||input.lastWeek>15)throw Error('마지막 학습 주차가 올바르지 않습니다.');output.lastWeek=input.lastWeek;return output;
}
function createStore(storage){let state=emptyState(),persistent=true,error=null;try{const saved=storage.getItem(KEY);if(saved)state=validateState(JSON.parse(saved));storage.setItem(KEY,JSON.stringify(state));}catch(e){persistent=false;error=e;}
 return{get state(){return state;},get persistent(){return persistent;},get error(){return error;},save(){try{storage.setItem(KEY,JSON.stringify(state));}catch(e){persistent=false;error=e;}return persistent;},replace(next){state=validateState(next);return this.save();},reset(){state=emptyState();return this.save();}};
}
function parseRoute(hash){const raw=String(hash||'#home').replace(/^#/,'');const[base,query='']=raw.split('?');const parts=base.split('/');const allowed=['home','curriculum','week','papers','paper','glossary','standards','downloads','workspace','about','search'];if(!allowed.includes(parts[0]))return{page:'notfound',id:'',query:''};return{page:parts[0],id:parts[1]||'',query:new URLSearchParams(query).get('q')||''};}
function matchesQuery(record,query){const tokens=normalizeText(query).split(' ').filter(Boolean);const hay=normalizeText(typeof record==='string'?record:JSON.stringify(record));return tokens.every(t=>hay.includes(t));}
function sortedPapers(papers){return [...papers].sort((a,b)=>a.week-b.week||a.id.localeCompare(b.id));}
const api={VERSION,KEY,escapeHTML,safeURL,safePDF,normalizeText,emptyState,validateState,createStore,parseRoute,matchesQuery,sortedPapers};root.HandbookCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
