import assert from 'node:assert/strict';
const base = process.env.HANDBOOK_TEST_ORIGIN;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Local integration origin required');
const checks=[];
const check=(label,ok)=>{assert(ok,label);checks.push(label);};
let r=await fetch(base+'/'); check('Existing handbook root renders',r.status===200 && (await r.text()).includes('uploads.js'));
r=await fetch(base+'/core.js');check('Public handbook script is anonymously readable',r.status===200 && (await r.text()).includes('HandbookCore'));
r=await fetch(base+'/papers/week-01/w01-p02_shevlane_extreme_risks.pdf');check('Rights-approved static PDF is anonymously readable',r.status===200 && Buffer.from(await r.arrayBuffer()).subarray(0,4).toString()==='%PDF');
r=await fetch(base+'/api/materials?week=1');check('Unauthenticated API is denied',r.status===401);
let identity;
if(process.env.HANDBOOK_TEST_DIRECT_WORKER==='1'){identity={'oai-authenticated-user-id':'local_test_owner','oai-authenticated-user-email':'test@example.invalid'};}else{
r=await fetch(base+'/signin-with-chatgpt?return_to=%2F',{redirect:'manual'});
const cookie=r.headers.get('set-cookie')?.split(';')[0];check('Supported local mock sign-in issues cookie',!!cookie);identity={Cookie:cookie};}
const headers={...identity,Origin:base,'X-Handbook-Upload':'1'};
const request=(path,options={})=>fetch(base+path,{...options,headers:{Connection:'close',...identity,...options.headers}});
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const form=(bytes=pdf,name='검증용_번역본.pdf')=>{const f=new FormData();f.set('week','1');f.set('title','');f.set('category','translation');f.set('rightsConfirmed','true');f.set('file',new Blob([bytes],{type:'application/pdf'}),name);return f;};
r=await request('/api/materials?week=1');check('Authenticated list succeeds',r.status===200);
r=await request('/api/materials',{method:'POST',headers,body:form()});const created=await r.json();check('Real local R2 upload and optional-title fallback',r.status===201 && created.material?.title==='검증용_번역본.pdf');
const id=created.material.id;
r=await fetch(base+'/api/materials/'+encodeURIComponent(id)+'/download');check('Anonymous material download is denied',r.status===401);
r=await fetch(base+'/api/materials',{method:'POST',headers:{Origin:base,'X-Handbook-Upload':'1',Connection:'close'},body:form()});check('Anonymous material upload is denied',r.status===401);
if(process.env.HANDBOOK_TEST_DIRECT_WORKER==='1'){
  const denied={'oai-authenticated-user-id':'unrelated_test_user','oai-authenticated-user-email':'unrelated@example.invalid',Connection:'close'};
  r=await fetch(base+'/api/materials?week=1',{headers:denied});check('Unrelated signed-in material list is denied',r.status===403);
  r=await fetch(base+'/api/materials/'+encodeURIComponent(id)+'/download',{headers:denied});check('Unrelated signed-in material download is denied',r.status===403);
  r=await fetch(base+'/api/materials',{method:'POST',headers:{...denied,Origin:base,'X-Handbook-Upload':'1'},body:form()});check('Unrelated signed-in material upload is denied',r.status===403);
}
r=await request('/api/materials?week=1');const listing=await r.json();check('Uploaded material persists in list',listing.materials.some(x=>x.id===id));
r=await request('/api/materials?week=2');check('Week isolation',!(await r.json()).materials.some(x=>x.id===id));
r=await request('/api/materials/'+encodeURIComponent(id)+'/download');check('Byte-equal attachment download',r.status===200 && Buffer.from(await r.arrayBuffer()).equals(pdf) && r.headers.get('content-disposition').startsWith('attachment;') && r.headers.get('x-content-type-options')==='nosniff');
r=await request('/api/materials',{method:'POST',headers:{Origin:base},body:form()});check('Missing custom header rejected',r.status===403);
r=await request('/api/materials',{method:'POST',headers:{...headers,Origin:'https://example.org'},body:form()});check('Cross-origin write rejected',r.status===403);
r=await request('/api/materials',{method:'POST',headers,body:form(Buffer.from('<html>bad</html>'),'wrong.pdf')});check('Renamed HTML rejected',r.status===415);
const max=20*1024*1024;const big=Buffer.alloc(max,32);pdf.copy(big,0);Buffer.from('\n%%EOF\n').copy(big,max-7);
r=await request('/api/materials',{method:'POST',headers,body:form(big,'boundary_20MiB.pdf')});const large=await r.json();check('20 MiB upload succeeds in local Worker',r.status===201 && large.material?.size===max);
r=await request('/api/materials/'+large.material.id+'/download');check('20 MiB download is byte-equal',r.status===200 && Buffer.from(await r.arrayBuffer()).equals(big));
r=await request('/api/materials',{method:'POST',headers,body:form(Buffer.alloc(max+1),'oversize.pdf')});check('Oversize upload rejected',r.status===413);
console.log(JSON.stringify({passed:checks.length,checks,note:'Local mock authentication and local R2 only; no production user data or files were written.'},null,2));
