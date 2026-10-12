#!/usr/bin/env python3
"""Rebuild the app from its complete public dataset, without the research workspace."""
from pathlib import Path
import json,re,shutil,argparse,hashlib
BASE=Path(__file__).resolve().parent;DIST=BASE/'public'
p=argparse.ArgumentParser();p.add_argument('--check-only',action='store_true');args=p.parse_args()
source=(DIST/'data.js').read_text()
prefix='window.HANDBOOK_DATA = '
assert source.startswith(prefix),'Unexpected data.js format'
data=json.loads(source[len(prefix):].strip().removesuffix(';'))
assert data['schemaVersion']==1
assert len(data['papers'])==40 and len({x['id'] for x in data['papers']})==40
assert {w['week'] for w in data['foundations']['weeks']}==set(range(1,16))
allowed=set()
for item in data['papers']+data['standards']:
    url=item.get('sitePdfUrl')
    if not url:continue
    assert item.get('redistribution')=='allowed','Remove the PDF link if redistribution permission changed'
    assert re.fullmatch(r'(?:papers/week-\d{2}|standards)/[A-Za-z0-9_.-]+\.pdf',url),'Unexpected hosted PDF path'
    file=(DIST/url).resolve();assert file.is_relative_to(DIST.resolve()) and file.exists(),f'Missing hosted PDF: {url}'
    with file.open('rb') as f:assert f.read(4)==b'%PDF'
    allowed.add(file)
for w in data['foundations']['weeks']:
    for q in w.get('quiz',[]):assert 0<=q['answer']<len(q['choices'])
# Rights-safe deletion: no obsolete binary remains available after a dataset edit.
if not args.check_only:
    for folder in ['papers','standards']:
        for file in (DIST/folder).rglob('*'):
            if file.is_file() and file.resolve() not in allowed:file.unlink()
    for file in (BASE/'src').rglob('*'):
        if file.is_file() and file.name != 'package.json':
            dest=DIST/file.relative_to(BASE/'src');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,dest)
    (DIST/'content-manifest.json').write_text(json.dumps({'schemaVersion':1,'paperCount':40,'weekCount':15,'quizCount':sum(len(w.get('quiz',[])) for w in data['foundations']['weeks']),'updatedAt':data['updatedAt'],'contentSha256':hashlib.sha256(json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').encode()).hexdigest(),'hostedPdfCount':sum(bool(x.get('sitePdfUrl')) for x in data['papers']),'hostedStandardPdfCount':sum(bool(x.get('sitePdfUrl')) for x in data['standards'])},ensure_ascii=False,indent=2))
print('Validated self-contained dataset: 40 papers, 15 weeks, '+str(len(allowed))+' hosted PDFs.')
