#!/usr/bin/env python3
"""Build an offline-compatible handbook from verified, allowlisted research JSON."""
from pathlib import Path
from collections import Counter
import argparse,json,shutil,hashlib,re,runpy,sys
BASE=Path(__file__).resolve().parent
ROOT=BASE.parent
DIST=BASE/'public'
parser=argparse.ArgumentParser();parser.add_argument('--check-only',action='store_true');args=parser.parse_args()
required=['papers_ethics.json','papers_governance.json','papers_security.json','foundations.json','standards.json']
if not all((ROOT/'research'/name).exists() for name in required) and (DIST/'data.js').exists():
    runpy.run_path(str(BASE/'rebuild.py'),run_name='__main__')
    raise SystemExit()
data={}
for filename in required:
    path=ROOT/'research'/filename
    if not path.exists(): raise SystemExit(f'Missing required research file: {filename}')
    data[filename]=json.loads(path.read_text())
raw_papers=[]
for name in required[:3]:
    content=data[name]
    raw_papers.extend(content if isinstance(content,list) else content.get('papers',[]))
raw_papers.sort(key=lambda p:(p['week'],p['id']))
assert len(raw_papers)==40,f'Expected 40 course papers, received {len(raw_papers)}'
assert len({p['id'] for p in raw_papers})==len(raw_papers),'Duplicate paper IDs'
assert Counter(p['week'] for p in raw_papers)=={1:2,2:3,3:3,4:3,5:3,6:4,7:2,9:3,10:3,11:4,12:4,13:3,14:3},'Syllabus per-week paper count mismatch'
PUBLIC_PAPER={'id','week','role','title','authors','year','venue','citation','landingUrl','pdfUrl','downloadStatus','redistribution','licenseNote','sourceVersion','readScope','summary','readingGuide','discussion','terms','evidence','corrections'}
PUBLIC_TERM={'term','korean','category','ordinaryMeaning','etymology','aiMeaning','paperReading','example','confusedWith','sourceUrl'}
PUBLIC_EVIDENCE={'url','supports','accessedDate'}
PUBLIC_FOUNDATIONS={'course','weeks','glossary','researchTerms','templates','updates','recommendedProjects','sourceNote'}
PUBLIC_STANDARD={'id','title','name','category','type','version','status','week','weeks','url','sourceUrl','landingUrl','officialUrl','pdfUrl','sourceVersion','checkedDate','summary','description','purpose','beginnerExplanation','keyPoints','readingGuide','teachingPoints','pitfalls','testMapping','mapping','requirements','limits','activities','sourceUrls','rights','access','downloadStatus','redistribution','licenseNote','updatedNote','evidence','checklist','learnerTask','teachingUse','whatItIs','whyItMatters','howToRead','cautions','application','scope','plainExplanation','testExamples','availability','copyrightNote','downloadNote','learningGuide','officialSources','primarySource','regulatoryNote','role','authors','year','venue','citation','readScope','discussion','terms','corrections','technicalMappingExamples'}
SUMMARY_FIELDS={'question','background','method','findings','limitations','significance','beginnerExplanation'}
def pick(d,fields): return {k:v for k,v in d.items() if k in fields}
def safe_url(url):
    return isinstance(url,str) and bool(re.match(r'^https?://[^\s]+$',url))
def clean_tree(value):
    """Never publish local path fields or acquisition/debug metadata."""
    if isinstance(value,dict):
        return {k:clean_tree(v) for k,v in value.items() if not re.search(r'local|private|scratch|debug|filepath|downloadVerification|sha256|bytes',k,re.I)}
    if isinstance(value,list): return [clean_tree(v) for v in value]
    if isinstance(value,str):
        assert not re.search(r'/workspace/|/tmp/|/(?:home|Users|root)/|fulltexts/|syllabus_extracted',value),'Private path detected in public text'
    return value
# Remove only owned generated assets. Downgraded permissions must remove previous PDF copies.
if not args.check_only:
    DIST.mkdir(exist_ok=True)
    for folder in ['papers','standards']:
        target=DIST/folder
        if target.exists():shutil.rmtree(target)

def published_pdf(raw,kind):
    if not raw.get('sitePdf') or raw.get('redistribution')!='allowed':return None
    local=raw.get('localPdf')
    if not local:return None
    source=(ROOT/local).resolve()
    assert source.is_relative_to((ROOT/'downloads').resolve()),'PDF source outside approved download collection'
    assert source.is_file(),f'Approved PDF is missing: {source.name}'
    with source.open('rb') as f: assert f.read(4)==b'%PDF',f'Not a PDF: {source.name}'
    assert re.match(r'^[a-zA-Z0-9_.-]+\.pdf$',source.name),'Unsafe PDF filename'
    target=Path(kind)/(f"week-{raw['week']:02d}" if kind=='papers' else '')/source.name
    if not args.check_only:
        (DIST/target).parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,DIST/target)
    return target.as_posix()

papers=[]
for raw in raw_papers:
    assert re.fullmatch(r'w%02d-p\d{2}' % raw['week'],raw['id']),'Invalid paper identifier'
    assert raw.get('title') and raw.get('citation') and safe_url(raw.get('landingUrl')),raw.get('id')
    assert len(raw.get('terms',[]))>=6,f"Insufficient terms for {raw['id']}"
    assert raw.get('summary') and raw.get('readingGuide'),f"Missing learning content for {raw['id']}"
    assert raw.get('readScope') in ['full_text','abstract_only']
    assert raw.get('downloadStatus') in ['downloaded','unavailable','html_only']
    p=pick(raw,PUBLIC_PAPER)
    p['summary']=pick(raw['summary'],SUMMARY_FIELDS)
    p['terms']=[pick(t,PUBLIC_TERM) for t in raw['terms']]
    p['evidence']=[pick(e,PUBLIC_EVIDENCE) for e in raw.get('evidence',[])]
    p['sitePdfUrl']=published_pdf(raw,'papers')
    papers.append(clean_tree(p))
foundations=clean_tree(pick(data['foundations.json'],PUBLIC_FOUNDATIONS))
assert len(foundations.get('weeks',[]))==15,'Expected 15 week lessons'
assert {w['week'] for w in foundations['weeks']}==set(range(1,16)),'Week IDs must span 1–15'
foundations['weeks'].sort(key=lambda w:w['week'])
for w in foundations['weeks']:
    assert w.get('plainLesson') and len(w.get('objectives',[]))>=3,f"Missing week lesson {w['week']}"
    for q in w.get('quiz',[]):
        assert q.get('question') and 0<=q['answer']<len(q['choices']) and q.get('explanation'),'Invalid quiz'
raw_standards=data['standards.json']
if isinstance(raw_standards,dict):raw_standards=next((raw_standards[k] for k in ['standards','resources','items'] if isinstance(raw_standards.get(k),list)),[])
standards=[]
for raw in raw_standards:
    s=pick(raw,PUBLIC_STANDARD)
    s['evidence']=[pick(e,PUBLIC_EVIDENCE) for e in raw.get('evidence',[]) if isinstance(e,dict)]
    s['sitePdfUrl']=published_pdf(raw,'standards')
    standards.append(clean_tree(s))
assert standards,'No standards resources found'
payload={'schemaVersion':1,'updatedAt':'2026-10-12','papers':papers,'foundations':foundations,'standards':standards}
encoded=json.dumps(payload,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
manifest={'schemaVersion':1,'paperCount':len(papers),'weekCount':15,'quizCount':sum(len(w.get('quiz',[])) for w in foundations['weeks']),'updatedAt':payload['updatedAt'],'contentSha256':hashlib.sha256(encoded.encode()).hexdigest(),'hostedPdfCount':sum(bool(p['sitePdfUrl']) for p in papers),'hostedStandardPdfCount':sum(bool(s['sitePdfUrl']) for s in standards)}
if not args.check_only:
    for path in (BASE/'src').rglob('*'):
        if path.is_file() and path.name != 'package.json':
            dest=DIST/path.relative_to(BASE/'src');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest)
    (DIST/'data.js').write_text('window.HANDBOOK_DATA = '+encoded+';\n')
    (DIST/'content-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps(manifest,ensure_ascii=False,indent=2))
