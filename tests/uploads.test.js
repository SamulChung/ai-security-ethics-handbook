'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/uploads.js'), 'utf8');
const tick = async () => { for (let n = 0; n < 4; n++) await new Promise(resolve => setImmediate(resolve)); };
function material(week = 1, suffix = '1', extra = {}) {
  return {id: String(week).padStart(2, '0') + '.12345678-1234-4567-89ab-' + suffix.padStart(12, '0'), week, title: '공유 요약', category: 'summary', filename: '요약.pdf', size: 2048, mime: 'application/pdf', createdAt: '2026-10-12T00:00:00Z', ...extra};
}
function harness(protocol = 'https:') {
  const requests = [], events = {};
  class Node {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this._text = ''; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.files = []; }
    get textContent() {return this._text + this.children.map(child => child.textContent).join('');}
    set textContent(value) {this._text = String(value); this.children = [];}
    set innerHTML(_) {throw Error('Unsafe HTML rendering attempted');}
    append(...children) {children.forEach(child => this.appendChild(child));}
    appendChild(child) {this.children.push(child); child.parentNode = this; return child;}
    replaceChildren(...children) {this.children = []; this._text = ''; this.append(...children);}
    setAttribute(name, value) {this.attributes[name] = String(value);}
    addEventListener(event, listener) {(this.listeners[event] ||= []).push(listener);}
    fire(event) {for (const listener of this.listeners[event] || []) listener({target: this, preventDefault() {}});}
  }
  const document = {createElement: tag => new Node(tag)};
  class FormData {constructor() {this.values = new Map();} append(key, value) {this.values.set(key, value);} get(key) {return this.values.get(key);}}
  const window = {document, location: {protocol}, AbortController, FormData, addEventListener(event, fn) {(events[event] ||= []).push(fn);}, fetch(url, options) {return new Promise((resolve, reject) => requests.push({url, options, resolve, reject}));}};
  vm.runInNewContext(source, {window, console});
  function find(root, predicate) {return [root, ...root.children.flatMap(child => flatten(child))].find(predicate);}
  function flatten(root) {return [root, ...root.children.flatMap(child => flatten(child))];}
  function mount(week = 1) {
    const container = new Node(); container.ownerDocument = document;
    const controller = window.HandbookUploads.mount(container, week);
    return {container, controller, get: name => find(container, node => node.name === name), form: () => find(container, node => node.tagName === 'form'), byClass: name => find(container, node => (node.className || '').split(' ').includes(name)), button: label => find(container, node => node.tagName === 'button' && node.textContent === label), nodes: () => flatten(container)};
  }
  async function respond(index, body, status = 200) {requests[index].resolve({ok: status >= 200 && status < 300, status, json: async () => body}); await tick();}
  async function load(panel, body = {}) {await respond(requests.length - 1, {materials: [], canUpload: true, ...body});}
  function select(panel, file = {name: '번역.pdf', size: 1024}, title = '한국어 번역') {panel.get('file').files = [file]; panel.get('file').fire('change'); panel.get('title').value = title; panel.get('title').fire('input'); panel.get('rightsConfirmed').checked = true; panel.get('rightsConfirmed').fire('change'); return file;}
  return {window, requests, events, mount, respond, load, select};
}
test('file:// is explicitly online-only and never calls the API', () => {
  const h = harness('file:'), p = h.mount();
  assert.match(p.container.textContent, /온라인 사이트에서 로그인/);
  assert.equal(p.form(), undefined); assert.equal(h.requests.length, 0);
});
test('all fifteen weeks mount isolated panels and same-origin uncached list requests', async () => {
  const h = harness();
  for (let week = 1; week <= 15; week++) {const p = h.mount(week), request = h.requests.at(-1); assert.equal(request.url, '/api/materials?week=' + week); assert.equal(request.options.credentials, 'same-origin'); assert.equal(request.options.cache, 'no-store'); assert(p.button('이 주차에 업로드').disabled); await h.load(p); assert(!p.button('이 주차에 업로드').disabled); p.controller.destroy();}
});
test('file, type, size and rights validation prevent requests and retain selection', async () => {
  const h = harness(), p = h.mount(); await h.load(p);
  const checks = [[null, /파일을 선택/], [{name: 'x.html', size: 5}, /지원하지 않는/], [{name: 'x.pdf', size: 0}, /비어 있는/], [{name: 'x.pdf', size: 20 * 1024 * 1024 + 1}, /20 MB 이하/]];
  for (const [file, pattern] of checks) {p.get('file').files = file ? [file] : []; p.get('file').fire('change'); p.form().fire('submit'); await tick(); assert.match(p.byClass('material-error').textContent, pattern); assert.equal(h.requests.length, 1);}
  h.select(p); p.get('rightsConfirmed').checked = false; p.get('rightsConfirmed').fire('change'); p.form().fire('submit'); assert.match(p.byClass('material-error').textContent, /확인란/); assert.equal(h.requests.length, 1);
});
test('GET server limits are rendered and enforced without broadening permitted types', async () => {
  const h = harness(), p = h.mount(); await h.load(p, {limits: {maxFileBytes: 1048576, maxMaterialsPerWeek: 40, allowedExtensions: ['png', 'html']}});
  assert.equal(p.get('file').accept, '.png'); assert.match(p.byClass('material-help').textContent, /1 MB/); assert.doesNotMatch(p.byClass('material-help').textContent, /40개/);
  h.select(p); p.form().fire('submit'); assert.match(p.byClass('material-error').textContent, /PNG/); assert.equal(h.requests.length, 1);
});
test('all supported extensions, including Korean word processors, can be submitted', async () => {
  for (const extension of ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'hwp', 'hwpx']) {const h = harness(), p = h.mount(); await h.load(p); h.select(p, {name: '공유.' + extension.toUpperCase(), size: 20 * 1024 * 1024}); p.form().fire('submit'); assert.equal(h.requests.length, 2, extension);}
});
test('multipart upload carries explicit rights and header; repeated submits make only one POST', async () => {
  const h = harness(), p = h.mount(4); await h.load(p); const file = h.select(p, {name: '번역.pdf', size: 1024}, '  한국어 번역  '); p.get('category').value = 'image'; p.get('category').fire('change');
  p.form().fire('submit'); p.form().fire('submit'); p.form().fire('submit');
  assert.equal(h.requests.length, 2); const request = h.requests[1]; assert.equal(request.url, '/api/materials'); assert.equal(request.options.method, 'POST'); assert.equal(request.options.credentials, 'same-origin'); assert.equal(request.options.headers['X-Handbook-Upload'], '1'); assert.equal(request.options.headers['Content-Type'], undefined);
  for (const [key, value] of Object.entries({file, week: '4', title: '한국어 번역', category: 'image', rightsConfirmed: 'true'})) assert.equal(request.options.body.get(key), value);
  assert.equal(p.form().attributes['aria-busy'], 'true'); assert(p.button('업로드 중…').disabled);
});
test('success is acknowledged only after POST and refreshes list, clearing completed draft', async () => {
  const h = harness(), p = h.mount(); await h.load(p); h.select(p); p.form().fire('submit'); assert.equal(p.byClass('material-list').children.length, 0);
  const item = material(); await h.respond(1, {material: item}, 201); assert.equal(h.requests[2].url, '/api/materials?week=1'); assert.equal(p.get('title').value, ''); assert.equal(p.get('rightsConfirmed').checked, false);
  await h.respond(2, {materials: [item], canUpload: true}); assert.match(p.byClass('material-status').textContent, /업로드했습니다/); assert.equal(p.byClass('material-list').children.length, 1); assert(!p.button('이 주차에 업로드').disabled);
});
test('server rejection preserves file, title, rights and category without automatic retry', async () => {
  const h = harness(), p = h.mount(); await h.load(p); h.select(p); p.form().fire('submit'); await h.respond(1, {error: '파일 내용이 PDF 형식과 일치하지 않습니다.'}, 400);
  assert.match(p.byClass('material-error').textContent, /PDF 형식/); assert.match(p.byClass('material-selected').textContent, /번역.pdf/); assert.equal(p.get('title').value, '한국어 번역'); assert(p.get('rightsConfirmed').checked); assert(!p.button('이 주차에 업로드').disabled); assert.equal(h.requests.length, 2);
});
test('ambiguous network failure requires explicit fresh list before retry and retains draft', async () => {
  const h = harness(), p = h.mount(); await h.load(p); h.select(p); p.form().fire('submit'); h.requests[1].reject(Error('연결이 끊어졌습니다.')); await tick();
  assert.match(p.byClass('material-error').textContent, /등록되었을 수도/); assert(p.button('이 주차에 업로드').disabled); p.form().fire('submit'); assert.equal(h.requests.length, 2);
  p.button('목록 새로고침').fire('click'); await h.respond(2, {materials: [material()], canUpload: true}); assert(!p.button('이 주차에 업로드').disabled); assert.equal(p.get('title').value, '한국어 번역');
});
test('read-only permission and failed list requests never grant upload access', async () => {
  const h = harness(), p = h.mount(); await h.load(p, {canUpload: false}); assert.match(p.byClass('material-status').textContent, /권한이 없습니다/); assert(p.button('이 주차에 업로드').disabled);
  p.button('목록 새로고침').fire('click'); await h.respond(1, {error: '로그인이 필요합니다.'}, 401); assert.match(p.container.textContent, /로그인이 필요/); h.select(p); p.form().fire('submit'); assert.equal(h.requests.length, 2);
});
test('filenames, titles and server errors render only text and download paths use validated IDs', async () => {
  const h = harness(), p = h.mount(), attack = '<img src=x onerror=alert(1)>';
  const item = material(1, '1', {title: attack, filename: '<script>alert(1)</script>.pdf'}); await h.load(p, {materials: [item]});
  assert.match(p.container.textContent, /<img src=x/); assert.equal(p.byClass('material-download').href, '/api/materials/' + encodeURIComponent(item.id) + '/download'); assert.equal(p.nodes().filter(node => node.tagName === 'img' || node.tagName === 'script').length, 0);
  h.select(p); p.form().fire('submit'); await h.respond(1, {error: attack}, 400); assert.equal(p.byClass('material-error').textContent, attack);
});
test('malformed or cross-week identifiers fail closed without download links', async () => {
  for (const bad of [material(2), material(1, '1', {id: '../../secret'}), material(1, '1', {category: '__proto__'}), material(1, '1', {size: '12'})]) {const h = harness(), p = h.mount(); await h.load(p, {materials: [bad]}); assert.equal(p.byClass('material-download'), undefined); assert.match(p.container.textContent, /목록 형식/); assert(p.button('이 주차에 업로드').disabled);}
});
test('pagination encodes opaque cursors and appends deduplicated safe entries', async () => {
  const h = harness(), p = h.mount(), first = material(), second = material(1, '2'); await h.load(p, {materials: [first], nextCursor: 'cursor&injected=/bad'});
  assert(!p.button('더 보기').hidden); p.button('더 보기').fire('click'); assert.equal(h.requests[1].url, '/api/materials?week=1&cursor=cursor%26injected%3D%2Fbad'); await h.respond(1, {materials: [first, second], canUpload: true, nextCursor: null});
  assert.equal(p.byClass('material-list').children.length, 2); assert(p.button('더 보기').hidden);
});
test('route leave aborts the list and ignores a stale response after remount', async () => {
  const h = harness(), old = h.mount(); old.controller.destroy(); assert(h.requests[0].options.signal.aborted);
  const current = h.mount(); await h.respond(1, {materials: [material(1, '2')], canUpload: true}); await h.respond(0, {materials: [material(1, '1')], canUpload: true});
  assert.equal(current.byClass('material-download').href, '/api/materials/' + material(1, '2').id + '/download'); assert.equal(old.byClass('material-list').children.length, 0);
});
test('navigating between weeks retains drafts; in-flight upload remains locked on return', async () => {
  const h = harness(), first = h.mount(); await h.load(first); h.select(first); first.form().fire('submit'); first.controller.destroy();
  const second = h.mount(2); await h.load(second); assert.equal(second.get('title').value, ''); assert.equal(second.byClass('material-list').children.length, 0); second.controller.destroy();
  const returned = h.mount(1); assert.equal(returned.get('title').value, '한국어 번역'); assert.match(returned.byClass('material-selected').textContent, /번역.pdf/); assert(returned.button('업로드 중…').disabled); returned.form().fire('submit'); assert.equal(h.requests.length, 3);
  await h.respond(1, {material: material()}, 201); await h.respond(3, {materials: [material()], canUpload: true}); assert.match(returned.byClass('material-status').textContent, /업로드했습니다/); assert.equal(second.byClass('material-list').children.length, 0); assert.equal(first.get('title').value, '한국어 번역');
});
test('beforeunload warns for a pending upload but not ordinary reads', async () => {
  const h = harness(), p = h.mount(); let prevented = false; const event = {preventDefault() {prevented = true;}};
  h.events.beforeunload[0](event); assert(!prevented); await h.load(p); h.select(p); p.form().fire('submit'); h.events.beforeunload[0](event); assert(prevented); assert.equal(event.returnValue, '');
  await h.respond(1, {error: '업로드 거절'}, 400); prevented = false; h.events.beforeunload[0](event); assert(!prevented);
});
test('online upload script is loaded before the app and the shared-material section is routed in-page', () => {
  const index = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8'), app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert(index.indexOf('src="uploads.js"') < index.indexOf('src="app.js"')); assert.match(app, /id="week-materials"/); assert.match(app, /materialPanel\?\.destroy\(\)/); assert.match(app, /HandbookUploads\.mount\(panel,Number\(r.id\)\)/); assert.doesNotMatch(source, /innerHTML|localStorage|sessionStorage/);
});

test('anonymous material access offers a top-level sign-in link without blocking public handbook navigation',async()=>{
  const h=harness(),p=h.mount(6);await h.respond(0,{error:'공유 자료는 승인된 계정으로 로그인 후 이용할 수 있습니다.'},401);
  const link=p.byClass('material-signin');assert(!link.hidden);assert.equal(link.href,'/signin-with-chatgpt?return_to='+encodeURIComponent('/#week/6'));assert.equal(link.attributes.target,'_top');assert(p.form().hidden);assert.match(p.container.textContent,/공유 자료는 승인된 계정으로 로그인 후 이용할 수 있습니다/);assert.equal(h.requests.length,1);
  p.controller.destroy();const next=h.mount(7);assert(next);assert.equal(h.requests.at(-1).url,'/api/materials?week=7');
});
test('revoked list access removes previously displayed private metadata and download links',async()=>{
  const h=harness(),p=h.mount();await h.load(p,{materials:[material()]});assert(p.byClass('material-download'));
  p.button('목록 새로고침').fire('click');await h.respond(1,{error:'승인된 계정으로 로그인해 주세요.'},403);
  assert.equal(p.byClass('material-download'),undefined);assert.equal(p.byClass('material-list').children.length,0);assert(p.form().hidden);assert(p.byClass('material-signin').hidden);assert(p.button('이 주차에 업로드').disabled);
  p.button('목록 새로고침').fire('click');await h.respond(2,{materials:[],canUpload:true});assert(!p.form().hidden);assert(!p.button('이 주차에 업로드').disabled);
});
test('expired upload authentication hides cached files and requires sign-in without automatic retry',async()=>{
  const h=harness(),p=h.mount();await h.load(p,{materials:[material()]});h.select(p);p.form().fire('submit');await h.respond(1,{error:'공유 자료는 승인된 계정으로 로그인 후 이용할 수 있습니다.'},401);
  assert.equal(p.byClass('material-download'),undefined);assert(p.form().hidden);assert(!p.byClass('material-signin').hidden);assert(p.button('이 주차에 업로드').disabled);assert.equal(h.requests.length,2);
});
test('public handbook copy distinguishes open lessons from restricted shared uploads',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');assert.match(app,/강의·용어·공개 원문 자료는 로그인 없이/);assert.match(app,/별도로 승인된 계정끼리만 공유/);assert.doesNotMatch(app,/온라인 사이트와 공유 자료는 사이트 접근 권한이 있는 계정/);
});
