#!/usr/bin/env python3
from pathlib import Path
from collections import Counter
from urllib.parse import urlparse
import json,re,sys,hashlib
BASE=Path(__file__).resolve().parent.parent;DIST=BASE/'public'
s=(DIST/'data.js').read_text();prefix='window.HANDBOOK_DATA = ';assert s.startswith(prefix)
d=json.loads(s[len(prefix):].strip().removesuffix(';'))
assert len(d['papers'])==40 and len({p['id'] for p in d['papers']})==40
assert Counter(p['week'] for p in d['papers'])=={1:2,2:3,3:3,4:3,5:3,6:4,7:2,9:3,10:3,11:4,12:4,13:3,14:3}
assert [p['id'] for p in d['papers']]==[p['id'] for p in sorted(d['papers'],key=lambda p:(p['week'],p['id']))]
assert len(d['foundations']['weeks'])==15
assert sum(len(w['quiz']) for w in d['foundations']['weeks'])==39
assert {w['week'] for w in d['foundations']['weeks']}==set(range(1,16))
for w in d['foundations']['weeks']:
 assert w['plainLesson'] and len(w['objectives'])>=3
 for q in w['quiz']:
  assert len(q['choices'])==4 and isinstance(q['answer'],int) and 0<=q['answer']<4 and q['explanation']
for paper in d['papers']:
 assert urlparse(paper['landingUrl']).scheme in ['http','https']
 assert len(paper['terms'])>=6 and len(paper['readingGuide'])>=3
 assert set(paper['summary'])>={'question','background','method','findings','limitations','significance','beginnerExplanation'}
 assert paper['readScope'] in ['full_text','abstract_only']
 assert not any(k in paper for k in ['localPdf','localHtml','localText','downloadVerification','allowPrivateBundle'])
for standard in d['standards']:
 assert standard['technicalMappingExamples'] and standard['citation'] and standard['terms']
for entry in d['papers']+d['standards']:
 if entry.get('sitePdfUrl'):
  assert entry['redistribution']=='allowed'
  file=DIST/entry['sitePdfUrl'];assert file.is_file()
  assert file.read_bytes()[:4]==b'%PDF'
  assert 'licenseNote' in entry
all_files=list(DIST.rglob('*'))
expected_pdf={x['sitePdfUrl'] for x in d['papers']+d['standards'] if x.get('sitePdfUrl')}
actual_pdf={str(p.relative_to(DIST)) for p in all_files if p.is_file() and p.suffix=='.pdf'}
assert actual_pdf==expected_pdf,('Stale or missing hosted PDFs',actual_pdf^expected_pdf)
assert not re.search(r'/workspace/|/tmp/|/(?:home|Users|root)/|fulltexts/|syllabus_extracted|\.hwp\b',s,re.I)
assert '</script>' not in s
html=(DIST/'index.html').read_text()
for name in ['styles.css','data.js','core.js','app.js']:assert (DIST/name).is_file() and name in html
assert 'type="module"' not in html and '<html lang="ko">' in html
assert '<meta name="viewport"' in html and '본문 바로가기' in html
app=(DIST/'app.js').read_text()
assert not re.search(r'\bfetch\s*\(|XMLHttpRequest|google-analytics|gtag\(|eval\(',app)
assert 'textContent' in app and 'C.escapeHTML' in app
assert 'window.confirm' in app and 'showModal' in app
assert '인쇄 / PDF로 저장' in app
assert '@media print' in (DIST/'styles.css').read_text()
assert '@media(max-width:760px)' in (DIST/'styles.css').read_text()
for file in all_files:
 if file.is_file():assert file.suffix in ['.html','.css','.js','.json','.pdf'],f'Unexpected deployed file: {file.name}'
print(f"Integrity checks passed: {len(d['papers'])} papers, 15 weeks, 39 quizzes, {len(expected_pdf)} rights-approved hosted PDFs, {len(d['standards'])} standards.")
