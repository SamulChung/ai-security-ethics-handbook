(function (root) {
'use strict';
const DEFAULT_LIMITS = Object.freeze({maxFileBytes: 20 * 1024 * 1024, maxMaterialsPerWeek: 100, allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'hwp', 'hwpx']});
const CATEGORIES = Object.freeze({translation: '번역본', summary: '요약 자료', image: '요약 이미지', other: '기타 자료'});
const TITLE_LIMIT = 160;
const entries = new Map();
const online = () => ['https:', 'http:'].includes(root.location.protocol);
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
function sizeLabel(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
}
function limitsFrom(value) {
  const next = {...DEFAULT_LIMITS, allowedExtensions: [...DEFAULT_LIMITS.allowedExtensions]};
  if (!value || typeof value !== 'object') return next;
  if (Number.isSafeInteger(value.maxFileBytes) && value.maxFileBytes > 0) next.maxFileBytes = Math.min(value.maxFileBytes, DEFAULT_LIMITS.maxFileBytes);
  if (Number.isSafeInteger(value.maxMaterialsPerWeek) && value.maxMaterialsPerWeek > 0) next.maxMaterialsPerWeek = Math.min(value.maxMaterialsPerWeek, DEFAULT_LIMITS.maxMaterialsPerWeek);
  if (Array.isArray(value.allowedExtensions)) {
    const allowed = [...new Set(value.allowedExtensions.filter(x => typeof x === 'string').map(x => x.toLowerCase().replace(/^\./, '')).filter(x => DEFAULT_LIMITS.allowedExtensions.includes(x)))];
    if (allowed.length) next.allowedExtensions = allowed;
  }
  return next;
}
function materialFrom(value, week) {
  if (!value || typeof value !== 'object' || value.week !== week || typeof value.id !== 'string') return null;
  if (!new RegExp('^' + String(week).padStart(2, '0') + '\\.' + uuid + '$', 'i').test(value.id)) return null;
  if (typeof value.filename !== 'string' || !value.filename || !Number.isSafeInteger(value.size) || value.size < 1 || !Object.hasOwn(CATEGORIES, value.category)) return null;
  return {id: value.id, week, title: typeof value.title === 'string' && value.title.trim() ? value.title : value.filename, category: value.category, filename: value.filename, size: value.size, createdAt: typeof value.createdAt === 'string' ? value.createdAt : ''};
}
function selectionError(draft, limits) {
  const file = draft.file;
  if (!file) return '업로드할 파일을 선택해 주세요.';
  const extension = file.name.split('.').pop().toLowerCase();
  if (!limits.allowedExtensions.includes(extension)) return '지원하지 않는 파일 형식입니다. ' + limits.allowedExtensions.map(x => x.toUpperCase()).join(', ') + ' 파일을 선택해 주세요.';
  if (!file.size) return '비어 있는 파일은 업로드할 수 없습니다.';
  if (file.size > limits.maxFileBytes) return '파일 한 개의 크기는 ' + sizeLabel(limits.maxFileBytes) + ' 이하여야 합니다.';
  if (draft.title.trim().length > TITLE_LIMIT) return '제목은 ' + TITLE_LIMIT + '자 이내로 입력해 주세요.';
  if (!Object.hasOwn(CATEGORIES, draft.category)) return '자료 종류를 선택해 주세요.';
  if (!draft.rights) return '공유 권한과 파일 내용을 확인한 뒤 확인란을 선택해 주세요.';
  return '';
}
function getEntry(week) {
  if (!entries.has(week)) entries.set(week, {week, draft: {file: null, title: '', category: 'translation', rights: false}, materials: [], nextCursor: null, hasLoaded: false, canUpload: false, loading: false, uploading: false, needsCheck: false, message: '', error: '', listError: '', limits: limitsFrom(), listeners: new Set(), loadVersion: 0, loadController: null});
  return entries.get(week);
}
function emit(entry) { entry.listeners.forEach(listener => listener()); }
async function responseJSON(response) {
  let body;
  try { body = await response.json(); } catch (_) { throw Error('서버 응답을 확인할 수 없습니다. 로그인 상태와 연결을 확인한 뒤 목록을 새로고침해 주세요.'); }
  if (!response.ok) {
    const fallback = response.status === 401 || response.status === 403 ? '로그인 또는 사이트 접근 권한을 확인해 주세요.' : '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    const error = Error(typeof body?.error === 'string' && body.error.trim() ? body.error : fallback);
    error.status = response.status;
    throw error;
  }
  return body;
}
async function refresh(entry, append = false) {
  if (!online() || (append && !entry.nextCursor)) return;
  const cursor = append ? entry.nextCursor : null;
  if (entry.loadController) entry.loadController.abort();
  const controller = new root.AbortController(), version = ++entry.loadVersion;
  entry.loadController = controller;
  entry.loading = true;
  entry.listError = '';
  emit(entry);
  try {
    const response = await root.fetch('/api/materials?week=' + entry.week + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), {credentials: 'same-origin', cache: 'no-store', headers: {Accept: 'application/json'}, signal: controller.signal});
    const body = await responseJSON(response);
    if (!Array.isArray(body?.materials) || typeof body.canUpload !== 'boolean') throw Error('자료 목록 응답을 확인할 수 없습니다. 잠시 뒤 새로고침해 주세요.');
    const materials = body.materials.map(value => materialFrom(value, entry.week));
    if (materials.some(value => !value) || new Set(materials.map(value => value.id)).size !== materials.length) throw Error('자료 목록 형식을 확인할 수 없습니다. 잠시 뒤 새로고침해 주세요.');
    if (controller.signal.aborted || version !== entry.loadVersion) return;
    if (body.nextCursor != null && (typeof body.nextCursor !== 'string' || body.nextCursor.length > 4096)) throw Error('다음 자료 목록을 확인할 수 없습니다. 목록을 새로고침해 주세요.');
    if (cursor && body.nextCursor === cursor) throw Error('다음 자료 목록을 불러오지 못했습니다. 목록을 새로고침해 주세요.');
    entry.materials = append ? [...entry.materials, ...materials.filter(value => !entry.materials.some(current => current.id === value.id))] : materials;
    entry.nextCursor = body.nextCursor || null;
    entry.canUpload = body.canUpload;
    entry.limits = limitsFrom(body.limits);
    entry.hasLoaded = true;
    if (!append) entry.needsCheck = false;
  } catch (error) {
    if (controller.signal.aborted || version !== entry.loadVersion) return;
    entry.listError = error.message || '자료 목록을 불러오지 못했습니다.';
    entry.canUpload = false;
  } finally {
    if (version === entry.loadVersion) {
      entry.loading = false;
      entry.loadController = null;
      emit(entry);
    }
  }
}
async function upload(entry) {
  if (!online() || entry.uploading || entry.loading || !entry.canUpload || entry.needsCheck) return;
  entry.error = selectionError(entry.draft, entry.limits);
  entry.message = '';
  if (entry.error) { emit(entry); return; }
  const form = new root.FormData();
  form.append('file', entry.draft.file);
  form.append('week', String(entry.week));
  form.append('title', entry.draft.title.trim());
  form.append('category', entry.draft.category);
  form.append('rightsConfirmed', 'true');
  entry.uploading = true;
  emit(entry);
  try {
    const response = await root.fetch('/api/materials', {method: 'POST', credentials: 'same-origin', headers: {Accept: 'application/json', 'X-Handbook-Upload': '1'}, body: form});
    const body = await responseJSON(response), material = materialFrom(body?.material, entry.week);
    if (!material) throw Error('업로드 응답을 확인할 수 없습니다. 목록에서 등록 여부를 확인해 주세요.');
    entry.materials = [material, ...entry.materials.filter(value => value.id !== material.id)];
    entry.draft = {file: null, title: '', category: entry.draft.category, rights: false};
    entry.message = '자료를 업로드했습니다. 이 사이트에 접근할 수 있는 사용자와 공유됩니다.';
    // The acknowledgement is real; keep it visible if the following list refresh fails.
    await refresh(entry);
  } catch (error) {
    entry.error = error.message || '업로드하지 못했습니다. 연결을 확인해 주세요.';
    if (!error.status || error.status >= 500) {
      // A lost response is not proof of a rejected write. Require a fresh list before a retry.
      entry.needsCheck = true;
      entry.error += ' 등록되었을 수도 있으니 목록 새로고침으로 확인한 뒤 다시 시도해 주세요.';
    }
  } finally {
    entry.uploading = false;
    emit(entry);
  }
}
function mount(container, week) {
  if (!container || !Number.isInteger(week) || week < 1 || week > 15) return {destroy() {}};
  const doc = container.ownerDocument || root.document;
  function node(tag, className, text) { const item = doc.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
  container.replaceChildren();
  if (!online()) {
    const notice = node('p', 'notice', '파일 업로드와 공유 자료 다운로드는 온라인 사이트에서 로그인한 뒤 사용할 수 있습니다. 오프라인 핸드북에는 파일을 업로드하거나 저장하지 않습니다.');
    notice.setAttribute('role', 'status'); container.appendChild(notice);
    return {destroy() {}};
  }
  const entry = getEntry(week);
  const form = node('form', 'material-form'), fields = node('fieldset', 'material-fields');
  const legend = node('legend', 'sr-only', week + '주차 공유 자료 업로드');
  fields.appendChild(legend);
  const fileGroup = node('div', 'field material-file-field'), fileLabel = node('label', '', '공유할 파일'), fileInput = node('input', 'material-file-input');
  fileInput.id = 'material-file-' + week; fileInput.type = 'file'; fileInput.name = 'file';
  fileLabel.setAttribute('for', fileInput.id);
  const limitText = node('p', 'material-help'); limitText.id = 'material-limits-' + week;
  const chosen = node('p', 'material-selected'); chosen.id = 'material-selected-' + week;
  fileInput.setAttribute('aria-describedby', limitText.id + ' ' + chosen.id);
  fileGroup.append(fileLabel, fileInput, limitText, chosen);
  const row = node('div', 'material-form-row'), titleGroup = node('div', 'field'), titleLabel = node('label', '', '자료 제목 (선택)'), titleInput = node('input', 'search-field');
  titleInput.id = 'material-title-' + week; titleInput.type = 'text'; titleInput.name = 'title'; titleInput.maxLength = TITLE_LIMIT; titleInput.placeholder = '비워 두면 파일명이 제목이 됩니다'; titleInput.value = entry.draft.title;
  titleLabel.setAttribute('for', titleInput.id); titleGroup.append(titleLabel, titleInput);
  const categoryGroup = node('div', 'field material-category-field'), categoryLabel = node('label', '', '자료 종류'), categoryInput = node('select', 'select-field');
  categoryInput.id = 'material-category-' + week; categoryInput.name = 'category';
  categoryLabel.setAttribute('for', categoryInput.id);
  Object.entries(CATEGORIES).forEach(([value, label]) => {const option = node('option', '', label); option.value = value; categoryInput.appendChild(option);});
  categoryInput.value = entry.draft.category;
  categoryGroup.append(categoryLabel, categoryInput); row.append(titleGroup, categoryGroup);
  const rightsLabel = node('label', 'material-rights'), rightsInput = node('input');
  rightsInput.type = 'checkbox'; rightsInput.name = 'rightsConfirmed'; rightsInput.checked = entry.draft.rights;
  rightsLabel.append(rightsInput, node('span', '', '이 파일을 사이트의 허용된 사용자와 공유할 권한이 있으며, 개인정보·비밀정보가 포함되지 않았는지 확인했습니다.'));
  const submit = node('button', 'button', '이 주차에 업로드'); submit.type = 'submit';
  fields.append(fileGroup, row, rightsLabel, submit); form.appendChild(fields);
  const status = node('p', 'material-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const errorBox = node('p', 'notice warning material-error'); errorBox.setAttribute('role', 'alert');
  const listHeading = node('div', 'section-heading material-list-heading'), listTitle = node('h3', '', '함께 보는 자료'), refreshButton = node('button', 'button secondary small', '목록 새로고침'); refreshButton.type = 'button';
  listHeading.append(listTitle, refreshButton);
  const listError = node('p', 'notice warning'); listError.setAttribute('role', 'status');
  const list = node('ul', 'material-list'); list.setAttribute('aria-label', week + '주차 공유 자료');
  const empty = node('p', 'material-empty'), moreButton = node('button', 'button secondary small material-more', '더 보기'); moreButton.type = 'button';
  container.append(form, status, errorBox, listHeading, listError, list, empty, moreButton);
  let lastMaterials, lastDraft = entry.draft;
  function paint() {
    const locked = entry.uploading || entry.loading || !entry.canUpload || entry.needsCheck;
    // Inputs stay editable after validation/server failures; only submission requires fresh permission.
    fields.disabled = entry.uploading;
    submit.disabled = locked;
    submit.textContent = entry.uploading ? '업로드 중…' : '이 주차에 업로드';
    form.setAttribute('aria-busy', String(entry.uploading));
    refreshButton.disabled = entry.loading || entry.uploading;
    moreButton.disabled = entry.loading || entry.uploading;
    moreButton.hidden = !entry.nextCursor;
    moreButton.textContent = entry.loading ? '자료 불러오는 중…' : '더 보기';
    refreshButton.textContent = entry.loading ? '목록 불러오는 중…' : '목록 새로고침';
    limitText.textContent = entry.limits.allowedExtensions.map(x => x.toUpperCase()).join(' · ') + ' / 파일당 ' + sizeLabel(entry.limits.maxFileBytes) + ' 이하';
    fileInput.accept = entry.limits.allowedExtensions.map(x => '.' + x).join(',');
    chosen.textContent = entry.draft.file ? '선택된 파일: ' + entry.draft.file.name + ' (' + sizeLabel(entry.draft.file.size) + ')' : '선택된 파일이 없습니다.';
    if (lastDraft !== entry.draft) {fileInput.value = ''; titleInput.value = entry.draft.title; categoryInput.value = entry.draft.category; rightsInput.checked = entry.draft.rights; lastDraft = entry.draft;}
    errorBox.textContent = entry.error; errorBox.hidden = !entry.error;
    listError.textContent = entry.listError + (entry.listError && entry.hasLoaded ? ' 아래는 마지막으로 확인한 목록입니다.' : ''); listError.hidden = !entry.listError;
    let message = entry.message;
    if (entry.uploading) message = '업로드 중입니다. 다른 주차로 이동해도 계속 진행됩니다. 이 주차에서 완료 여부를 확인해 주세요.';
    else if (entry.needsCheck) message = '다시 업로드하기 전에 목록을 새로고침해 중복 등록 여부를 확인해 주세요.';
    else if (!message && entry.loading) message = '공유 자료와 업로드 권한을 확인하고 있습니다.';
    else if (entry.hasLoaded && !entry.canUpload && !entry.listError) message = '현재 계정에는 자료 업로드 권한이 없습니다.';
    status.textContent = message; status.hidden = !message;
    listTitle.textContent = '함께 보는 자료' + (entry.hasLoaded ? ' · ' + entry.materials.length + '개' + (entry.nextCursor ? ' (추가 자료 있음)' : '') : '');
    list.setAttribute('aria-busy', String(entry.loading));
    if (lastMaterials !== entry.materials) {
      list.replaceChildren();
      entry.materials.forEach(material => {
        const item = node('li', 'material-item'), details = node('div', 'material-details'), category = node('span', 'tag muted', CATEGORIES[material.category]);
        const title = node('h4', '', material.title), filename = node('p', 'material-filename', material.filename);
        const date = new Date(material.createdAt), validDate = material.createdAt && Number.isFinite(date.getTime());
        const metadata = node('p', 'material-metadata', sizeLabel(material.size) + (validDate ? ' · ' + date.toLocaleDateString('ko-KR') + ' 등록' : ''));
        details.append(category, title, filename, metadata);
        const download = node('a', 'button secondary small material-download', '다운로드 ↓');
        download.href = '/api/materials/' + encodeURIComponent(material.id) + '/download'; download.download = material.filename; download.setAttribute('aria-label', material.title + ' 다운로드');
        item.append(details, download); list.appendChild(item);
      });
      lastMaterials = entry.materials;
    }
    empty.hidden = !!entry.materials.length || !!entry.listError;
    empty.textContent = entry.loading && !entry.hasLoaded ? '공유 자료를 불러오고 있습니다.' : '아직 공유한 자료가 없습니다. 이 주차의 첫 자료를 올려 보세요.';
  }
  fileInput.addEventListener('change', () => {if (entry.uploading) return; entry.draft.file = fileInput.files?.[0] || null; entry.error = ''; entry.message = ''; paint();});
  titleInput.addEventListener('input', () => {if (!entry.uploading) entry.draft.title = titleInput.value;});
  categoryInput.addEventListener('change', () => {if (!entry.uploading) entry.draft.category = categoryInput.value;});
  rightsInput.addEventListener('change', () => {if (!entry.uploading) entry.draft.rights = rightsInput.checked;});
  form.addEventListener('submit', event => {event.preventDefault(); void upload(entry);});
  refreshButton.addEventListener('click', () => {if (!entry.uploading) void refresh(entry);});
  moreButton.addEventListener('click', () => {if (!entry.uploading && !entry.loading) void refresh(entry, true);});
  entry.listeners.add(paint);
  paint();
  if (!entry.uploading) void refresh(entry);
  return {destroy() {
    entry.listeners.delete(paint);
    if (!entry.listeners.size && entry.loadController && !entry.uploading) {entry.loadController.abort(); entry.loadVersion++; entry.loadController = null; entry.loading = false;}
  }};
}
root.addEventListener('beforeunload', event => {
  if ([...entries.values()].some(entry => entry.uploading)) {event.preventDefault(); event.returnValue = '';}
});
root.HandbookUploads = Object.freeze({mount});
})(window);
