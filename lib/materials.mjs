/** Private, shared course files. Identity is supplied only by Sites dispatch. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
export const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'hwp', 'hwpx'];
export const CATEGORIES = ['translation', 'summary', 'image', 'other'];
const MIME = {pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',hwp:'application/x-hwp',hwpx:'application/hwp+zip'};
const ID_PATTERN = /^(0[1-9]|1[0-5])\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const LIMITS = {maxFileBytes:MAX_FILE_BYTES,maxMaterialsPerWeek:100,admissionThreshold:true,allowedExtensions:ALLOWED_EXTENSIONS};
const securityHeaders = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
class MaterialError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function fail(status,code,message){throw new MaterialError(status,code,message);}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...securityHeaders,'Content-Type':'application/json; charset=utf-8'}});}
function failure(error){return error instanceof MaterialError?json({error:error.message,code:error.code},error.status):json({error:'공유 자료 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',code:'storage_unavailable'},503);}
function authorize(request,env){
  if(!request.headers.get('oai-authenticated-user-id')?.trim()||!request.headers.get('oai-authenticated-user-email')?.trim())fail(401,'authentication_required','사이트에 로그인한 뒤 공유 자료를 이용해 주세요.');
  if(!env?.BUCKET)fail(503,'storage_unavailable','현재 환경에서는 공유 파일 저장소를 사용할 수 없습니다. 게시된 사이트에서 이용해 주세요.');
}
function authorizeWrite(request){
  let origin;try{origin=new URL(request.url).origin;}catch{fail(400,'invalid_request','잘못된 요청입니다.');}
  if(request.headers.get('origin')!==origin||request.headers.get('x-handbook-upload')!=='1')fail(403,'origin_not_allowed','이 사이트의 업로드 화면에서 다시 시도해 주세요.');
  const site=request.headers.get('sec-fetch-site');
  if(site && site!=='same-origin' && site!=='none')fail(403,'origin_not_allowed','다른 사이트에서 전송한 업로드는 허용되지 않습니다.');
}
function weekNumber(value){if(typeof value!=='string'||! /^(?:[1-9]|1[0-5])$/.test(value))fail(400,'invalid_week','주차는 1부터 15까지 선택해 주세요.');return Number(value);}
function prefix(week){return `materials/v1/week-${String(week).padStart(2,'0')}/`;}
function parseId(id){const match=typeof id==='string'&&ID_PATTERN.exec(id);if(!match)fail(404,'not_found','공유 파일을 찾을 수 없습니다.');return {week:Number(match[1]),key:prefix(Number(match[1]))+id};}
function plainText(value,max,field){
  if(typeof value!=='string')fail(400,'invalid_metadata',`${field}을 확인해 주세요.`);
  const text=value.trim().normalize('NFC');
  if(!text||Array.from(text).length>max||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(text))fail(400,'invalid_metadata',`${field}을 ${max}자 이내의 일반 텍스트로 입력해 주세요.`);
  return text;
}
function filenameInfo(name){const filename=plainText(name,200,'파일 이름');if(/[\\/:]/.test(filename)||/[. ]$/.test(filename))fail(400,'invalid_filename','파일 이름에 경로나 특수 제어 문자를 사용할 수 없습니다.');const ext=filename.split('.').pop()?.toLowerCase();if(!ALLOWED_EXTENSIONS.includes(ext)||!filename.includes('.'))fail(415,'unsupported_file','PDF, PNG, JPEG, WebP, DOCX, HWP, HWPX 파일만 올릴 수 있습니다.');return{filename,ext};}
/** Five-part streaming parser: bounds headers/fields before allocating file storage. */
async function readUploadForm(request){
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY_BYTES))fail(413,'file_too_large','파일은 20 MiB 이하로 올려 주세요.');
  const type=request.headers.get('content-type')||'';
  const match=/^multipart\/form-data\s*;\s*boundary=(?:"([A-Za-z0-9'()+_,.\/:=? -]{1,70})"|([A-Za-z0-9'()+_,.\/:=?-]{1,70}))\s*$/i.exec(type);
  if(type.length>256||!match)fail(415,'invalid_form','파일 업로드 양식을 사용해 주세요.');
  if(!request.body)fail(400,'empty_file','업로드할 파일을 선택해 주세요.');
  const boundary=match[1]||match[2],initial=encoder.encode('--'+boundary+'\r\n'),delimiter=encoder.encode('\r\n--'+boundary),headerEnd=Uint8Array.from([13,10,13,10]);
  const fields=new Map(),allowed=['file','week','title','category','rightsConfirmed'];let state='initial',pending=new Uint8Array(),part=null,total=0,partCount=0;
  function invalid(){fail(400,'invalid_form','업로드 요청을 읽지 못했습니다. 파일과 필수 정보를 다시 확인해 주세요.');}
  function find(bytes,pattern,from=0){let at=from;while((at=bytes.indexOf(pattern[0],at))!==-1){if(at+pattern.length>bytes.length)return -1;let equal=true;for(let i=1;i<pattern.length;i++)if(bytes[at+i]!==pattern[i]){equal=false;break;}if(equal)return at;at++;}return -1;}
  function add(data){if(!data.length)return;part.size+=data.length;if(part.size>(part.name==='file'?MAX_FILE_BYTES:4096)){if(part.name==='file')fail(413,'file_too_large','파일은 20 MiB 이하로 올려 주세요.');invalid();}let at=0;while(at<data.length){const count=Math.min(part.buffer.length-part.used,data.length-at);part.buffer.set(data.subarray(at,at+count),part.used);part.used+=count;at+=count;if(part.used===part.buffer.length){part.chunks.push(part.buffer);part.buffer=new Uint8Array(part.name==='file'?65536:4096);part.used=0;}}}
  function finish(){if(part.used)part.chunks.push(part.buffer.subarray(0,part.used));const data=new Uint8Array(part.size);let offset=0;for(const chunk of part.chunks){data.set(chunk,offset);offset+=chunk.length;}if(part.name==='file')fields.set('file',{name:part.filename,size:data.length,data});else{try{fields.set(part.name,decoder.decode(data));}catch{invalid();}}part=null;}
  function begin(headers){if(++partCount>5)invalid();let text;try{text=decoder.decode(headers);}catch{invalid();}const lines=text.split('\r\n'),parsed=new Map();for(const line of lines){const separator=line.indexOf(':');if(separator<1)invalid();const name=line.slice(0,separator).trim().toLowerCase(),value=line.slice(separator+1).trim();if(!['content-disposition','content-type'].includes(name)||parsed.has(name))invalid();parsed.set(name,value);}
    const disposition=/^form-data;\s*name="([^"\r\n]+)"(?:;\s*filename="([^"\r\n]*)")?$/i.exec(parsed.get('content-disposition')||'');
    if(!disposition)invalid();const name=disposition[1],filename=disposition[2];if(!allowed.includes(name)||fields.has(name)||(name==='file')!==(filename!==undefined))invalid();if(name==='file')filenameInfo(filename);part={name,filename,chunks:[],size:0,buffer:new Uint8Array(name==='file'?65536:4096),used:0};
  }
  function process(){while(true){
    if(state==='initial'){if(pending.length<initial.length)return;for(let i=0;i<initial.length;i++)if(pending[i]!==initial[i])invalid();pending=pending.subarray(initial.length);state='headers';}
    else if(state==='headers'){const at=find(pending,headerEnd);if(at<0){if(pending.length>4096)invalid();return;}if(at>4096)invalid();begin(pending.subarray(0,at));pending=pending.subarray(at+4);state='body';}
    else if(state==='body'){let at=find(pending,delimiter),incomplete=false;while(at>=0){const end=at+delimiter.length;if(end+2>pending.length){incomplete=true;break;}if((pending[end]===45&&pending[end+1]===45)||(pending[end]===13&&pending[end+1]===10))break;at=find(pending,delimiter,at+1);}if(at>=0&&!incomplete){add(pending.subarray(0,at));finish();pending=pending.subarray(at+delimiter.length);state='ending';continue;}const flush=incomplete?at:Math.max(0,pending.length-delimiter.length-2);add(pending.subarray(0,flush));pending=pending.subarray(flush);return;}
    else if(state==='ending'){if(pending.length<2)return;if(pending[0]===45&&pending[1]===45){pending=pending.subarray(2);state='done';}else if(pending[0]===13&&pending[1]===10){pending=pending.subarray(2);state='headers';}else invalid();}
    else{if(pending.length>2||(pending.length>=1&&pending[0]!==13)||(pending.length===2&&pending[1]!==10))invalid();return;}
  }}
  const reader=request.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BODY_BYTES)fail(413,'file_too_large','파일은 20 MiB 이하로 올려 주세요.');if(pending.length){const combined=new Uint8Array(pending.length+value.length);combined.set(pending);combined.set(value,pending.length);pending=combined;}else pending=value;process();}process();if(state!=='done'||pending.length===1||fields.size!==5)invalid();return fields;}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
const starts=(bytes,signature,offset=0)=>signature.every((x,i)=>bytes[offset+i]===x);
const ascii=(bytes,start,end)=>new TextDecoder('latin1').decode(bytes.subarray(start,end));
function contentError(){fail(415,'content_mismatch','파일 확장자와 실제 내용이 맞지 않거나 지원하지 않는 파일입니다. 원본을 확인해 주세요.');}
function viewFor(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}

/** Read central-directory metadata without decompressing untrusted ZIP members. */
function zipEntries(bytes){
  const view=viewFor(bytes);if(bytes.length<22||!starts(bytes,[0x50,0x4b,3,4]))contentError();
  let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){eocd=i;break;}}
  if(eocd<0||view.getUint16(eocd+4,true)!==0||view.getUint16(eocd+6,true)!==0)contentError();
  const count=view.getUint16(eocd+10,true),centralSize=view.getUint32(eocd+12,true),centralStart=view.getUint32(eocd+16,true);
  if(!count||count>4096||view.getUint16(eocd+8,true)!==count||centralStart+centralSize!==eocd)contentError();
  const entries=new Map();let at=centralStart,totalExpanded=0;
  for(let i=0;i<count;i++){
    if(at+46>eocd||view.getUint32(at,true)!==0x02014b50)contentError();
    const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),compressed=view.getUint32(at+20,true),expanded=view.getUint32(at+24,true),nameSize=view.getUint16(at+28,true),extraSize=view.getUint16(at+30,true),commentSize=view.getUint16(at+32,true),disk=view.getUint16(at+34,true),local=view.getUint32(at+42,true);
    const next=at+46+nameSize+extraSize+commentSize;
    if(next>eocd||!nameSize||nameSize>1024||disk!==0||(flags&0x41)!==0||![0,8].includes(method)||compressed===0xffffffff||expanded===0xffffffff||local===0xffffffff)contentError();
    let name;try{name=decoder.decode(bytes.subarray(at+46,at+46+nameSize));}catch{contentError();}
    if(name.startsWith('/')||name.includes('\\')||name.includes('\0')||name.split('/').includes('..')||entries.has(name))contentError();
    totalExpanded+=expanded;if(totalExpanded>100*1024*1024||(expanded>1024*1024&&expanded>Math.max(1,compressed)*200))contentError();
    if(local+30>centralStart||view.getUint32(local,true)!==0x04034b50||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method)contentError();
    const localNameSize=view.getUint16(local+26,true),localExtraSize=view.getUint16(local+28,true),dataStart=local+30+localNameSize+localExtraSize;
    if(dataStart+compressed>centralStart||localNameSize!==nameSize)contentError();
    for(let j=0;j<nameSize;j++)if(bytes[local+30+j]!==bytes[at+46+j])contentError();
    if(method===0&&expanded!==compressed)contentError();
    entries.set(name,{method,compressed,expanded,dataStart});at=next;
  }
  if(at!==eocd)contentError();return entries;
}

/** Verify HWP 5's compound-file directory and actual FileHeader stream. */
function validateHwp(bytes){
  if(bytes.length<512||!starts(bytes,[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))contentError();
  const view=viewFor(bytes),major=view.getUint16(26,true),shift=view.getUint16(30,true),sectorSize=2**shift;
  if(view.getUint16(28,true)!==0xfffe||!((major===3&&shift===9)||(major===4&&shift===12))||view.getUint16(32,true)!==6||bytes.length%sectorSize!==0)contentError();
  const sectors=bytes.length/sectorSize-1,perSector=sectorSize/4,sector=id=>{if(id>=sectors)contentError();return (id+1)*sectorSize;};
  const fatCount=view.getUint32(44,true),fatSectors=[],seenDifat=new Set();
  if(!fatCount||fatCount>sectors)contentError();
  for(let i=0;i<109&&fatSectors.length<fatCount;i++){const id=view.getUint32(76+i*4,true);if(id<0xfffffffa)fatSectors.push(id);}
  let difat=view.getUint32(68,true),difatCount=view.getUint32(72,true);if(difatCount>sectors)contentError();
  for(let i=0;i<difatCount;i++){if(seenDifat.has(difat))contentError();seenDifat.add(difat);const start=sector(difat);for(let j=0;j<perSector-1&&fatSectors.length<fatCount;j++){const id=view.getUint32(start+j*4,true);if(id<0xfffffffa)fatSectors.push(id);}difat=view.getUint32(start+sectorSize-4,true);}
  if(fatSectors.length!==fatCount||new Set(fatSectors).size!==fatCount)contentError();fatSectors.forEach(sector);
  const next=id=>{if(id>=sectors||Math.floor(id/perSector)>=fatSectors.length)contentError();return view.getUint32(sector(fatSectors[Math.floor(id/perSector)])+(id%perSector)*4,true);};
  const chain=start=>{const ids=[],seen=new Set();let id=start;while(id!==0xfffffffe){if(id>=sectors||seen.has(id)||ids.length>=sectors)contentError();seen.add(id);ids.push(id);id=next(id);}return ids;};
  const dirs=chain(view.getUint32(48,true));let header,root;
  for(const id of dirs){const start=sector(id);for(let offset=0;offset<sectorSize;offset+=128){const at=start+offset,type=bytes[at+66],nameBytes=view.getUint16(at+64,true);if(!type)continue;if(nameBytes<2||nameBytes>64||nameBytes%2)contentError();let name='';for(let p=0;p<nameBytes-2;p+=2)name+=String.fromCharCode(view.getUint16(at+p,true));const size=view.getUint32(at+120,true);if(view.getUint32(at+124,true)!==0)contentError();const entry={start:view.getUint32(at+116,true),size};if(type===5)root=entry;if(type===2&&name==='FileHeader')header=entry;}}
  if(!root||!header||header.size<40||header.size>4096)contentError();let at;
  if(header.size<view.getUint32(56,true)){
    const rootChain=chain(root.start),miniOffset=header.start*64;if(miniOffset+40>root.size||Math.floor(miniOffset/sectorSize)>=rootChain.length)contentError();
    at=sector(rootChain[Math.floor(miniOffset/sectorSize)])+(miniOffset%sectorSize);
  }else at=sector(header.start);
  if(ascii(bytes,at,at+17)!=='HWP Document File')contentError();
  if(view.getUint32(at+36,true)&2)fail(415,'encrypted_file','암호로 잠긴 HWP 파일은 올릴 수 없습니다. 암호를 해제하거나 PDF로 저장해 주세요.');
}

export function sniffFile(bytes,ext){
  if(!(bytes instanceof Uint8Array)||!bytes.length)contentError();
  if(ext==='pdf'){if(!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n\s]/.test(ascii(bytes,0,12))||!ascii(bytes,Math.max(0,bytes.length-2048),bytes.length).includes('%%EOF'))contentError();}
  else if(ext==='png'){if(bytes.length<45||!starts(bytes,[137,80,78,71,13,10,26,10])||viewFor(bytes).getUint32(8)!==13||ascii(bytes,12,16)!=='IHDR'||!viewFor(bytes).getUint32(16)||!viewFor(bytes).getUint32(20)||!starts(bytes,[0,0,0,0,73,69,78,68,174,66,96,130],bytes.length-12))contentError();}
  else if(ext==='jpg'||ext==='jpeg'){if(bytes.length<12||!starts(bytes,[255,216,255])||!starts(bytes,[255,217],bytes.length-2))contentError();}
  else if(ext==='webp'){if(bytes.length<20||ascii(bytes,0,4)!=='RIFF'||ascii(bytes,8,12)!=='WEBP'||viewFor(bytes).getUint32(4,true)!==bytes.length-8||!['VP8 ','VP8L','VP8X'].includes(ascii(bytes,12,16)))contentError();}
  else if(ext==='docx'||ext==='hwpx'){
    const entries=zipEntries(bytes);
    if(ext==='docx'){if(!['[Content_Types].xml','_rels/.rels','word/document.xml'].every(k=>entries.has(k))||[...entries.keys()].some(k=>/vbaProject\.bin$/i.test(k)))contentError();}
    else{if(!['mimetype','version.xml','Contents/content.hpf','Contents/header.xml'].every(k=>entries.has(k)))contentError();const m=entries.get('mimetype');if(m.method!==0||m.expanded!==19||ascii(bytes,m.dataStart,m.dataStart+m.compressed)!=='application/hwp+zip')contentError();}
  }else if(ext==='hwp')validateHwp(bytes);else contentError();
  return MIME[ext];
}
function materialFromObject(object,expectedWeek){
  const meta=object.customMetadata||{},id=object.key.slice(object.key.lastIndexOf('/')+1);let parsed;try{parsed=parseId(id);}catch{return null;}
  if(parsed.week!==expectedWeek||object.key!==parsed.key||meta.schemaVersion!=='1'||meta.week!==String(expectedWeek)||meta.rightsConfirmed!=='true'||!CATEGORIES.includes(meta.category))return null;
  let filename,ext,title;try{({filename,ext}=filenameInfo(meta.filename));title=plainText(meta.title,160,'자료 제목');}catch{return null;}
  if(meta.mime!==MIME[ext]||!Number.isSafeInteger(object.size)||object.size<1||object.size>MAX_FILE_BYTES)return null;
  const date=object.uploaded instanceof Date?object.uploaded:new Date(meta.createdAt);if(!Number.isFinite(date.getTime()))return null;
  return{id,week:expectedWeek,title,category:meta.category,filename,size:object.size,mime:meta.mime,createdAt:date.toISOString()};
}
export async function listMaterials(request,env){try{
  authorize(request,env);const url=new URL(request.url),week=weekNumber(url.searchParams.get('week')),cursor=url.searchParams.get('cursor');
  if(cursor!==null&&(cursor.length>4096||/[\u0000-\u001f]/.test(cursor)))fail(400,'invalid_cursor','목록을 새로고침해 주세요.');
  const listed=await env.BUCKET.list({prefix:prefix(week),limit:100,include:['customMetadata'],...(cursor?{cursor}:{})});
  const materials=listed.objects.map(o=>materialFromObject(o,week)).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return json({materials,canUpload:true,limits:LIMITS,nextCursor:listed.truncated?listed.cursor:null});
}catch(error){return failure(error);}}
// Admission threshold only: simultaneous accepted requests can slightly exceed 100.
async function checkCapacity(bucket,week){
  let count=0,cursor;do{const page=await bucket.list({prefix:prefix(week),limit:100,...(cursor?{cursor}:{})});count+=page.objects.length;if(count>=100)fail(409,'week_capacity','이 주차에 공유 자료가 100개 이상 있어 새 업로드를 잠시 제한합니다.');cursor=page.truncated?page.cursor:null;}while(cursor);
}
export async function uploadMaterial(request,env){try{
  authorize(request,env);authorizeWrite(request);
  const form=await readUploadForm(request);
  const week=weekNumber(form.get('week')),category=form.get('category');
  if(!CATEGORIES.includes(category))fail(400,'invalid_category','자료 종류를 선택해 주세요.');if(form.get('rightsConfirmed')!=='true')fail(400,'rights_required','직접 만든 자료이거나 공유 권한이 있는 자료인지 확인해 주세요.');
  const file=form.get('file');if(!file||typeof file!=='object')fail(400,'empty_file','업로드할 파일을 선택해 주세요.');if(!file.size)fail(400,'empty_file','빈 파일은 올릴 수 없습니다.');
  const {filename,ext}=filenameInfo(file.name),data=file.data,mime=sniffFile(data,ext);
  const rawTitle=form.get('title'),title=typeof rawTitle==='string'&&!rawTitle.trim()?Array.from(filename).slice(0,160).join(''):plainText(rawTitle,160,'자료 제목');
  await checkCapacity(env.BUCKET,week);
  const id=String(week).padStart(2,'0')+'.'+crypto.randomUUID(),key=prefix(week)+id,createdAt=new Date().toISOString();
  const customMetadata={schemaVersion:'1',week:String(week),title,category,filename,mime,createdAt,rightsConfirmed:'true'};
  if(encoder.encode(JSON.stringify(customMetadata)).length>4096)fail(400,'invalid_metadata','자료 제목이나 파일 이름이 너무 깁니다.');
  const saved=await env.BUCKET.put(key,data,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:mime},customMetadata});
  if(!saved)fail(409,'upload_conflict','파일 저장이 겹쳤습니다. 다시 시도해 주세요.');
  return json({material:{id,week,title,category,filename,size:data.byteLength,mime,createdAt}},201);
}catch(error){
  // Early authorization/header rejections must release the unread request stream.
  // Never drain it, acquire another reader, or let cleanup replace the real error.
  try{if(request.body&&!request.body.locked)await request.body.cancel();}catch{}
  return failure(error);
}}
function attachmentHeader(filename){const encoded=encodeURIComponent(filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());return `attachment; filename="course-material.${filename.split('.').pop().toLowerCase()}"; filename*=UTF-8''${encoded}`;}
export async function downloadMaterial(request,env,id){try{
  authorize(request,env);const {week,key}=parseId(id),object=await env.BUCKET.get(key);if(!object)fail(404,'not_found','공유 파일을 찾을 수 없습니다.');const material=materialFromObject(object,week);if(!material)fail(404,'not_found','공유 파일을 찾을 수 없습니다.');
  return new Response(object.body,{headers:{...securityHeaders,'Content-Type':material.mime,'Content-Length':String(material.size),'Content-Disposition':attachmentHeader(material.filename),'Content-Security-Policy':"sandbox; default-src 'none'; base-uri 'none'",'X-Download-Options':'noopen'}});
}catch(error){return failure(error);}}
