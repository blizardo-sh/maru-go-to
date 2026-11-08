#!/usr/bin/env python3
"""Extract pinned official tables for editorial comparison, never during app startup."""
import json,hashlib,re,sys
from pathlib import Path
import pdfplumber
root=Path(__file__).resolve().parents[1];cache=Path(sys.argv[1]);manifest=json.loads((root/'materials/books/source-manifest.json').read_text())['sources'];out=[]
for tag,book in [('a2-1-a','marugoto.elementary1-a2'),('a2-1-c','marugoto.elementary1-a2'),('a2-2-a','marugoto.elementary2-a2'),('a2-2-c','marugoto.elementary2-a2'),('a2b1','marugoto.pre-intermediate-a2b1')]:
 name=tag+'-vocabulary.pdf';src=next(s for s in manifest if s['file']==name);path=cache/name
 assert hashlib.sha256(path.read_bytes()).hexdigest()==src['sha256'];unit=None
 for pi,page in enumerate(pdfplumber.open(path).pages):
  for table in page.extract_tables():
   for ri,row in enumerate(table):
    if len(row)!=6 or row[0]=='か' or not row[1]:continue
    if row[0] and row[0].strip().isdigit():unit=int(row[0].strip())
    entry,kanji,accent,ru=[(x or '').replace('\n','') for x in row[1:5]]
    assert unit and ru,(tag,pi,row)
    out.append(dict(source=tag,page=pi+1,row=ri+1,bookId=book,lessonId=f'{book}.{"topic" if tag=="a2b1" else "lesson"}.{unit:02}',entry=entry,kanji=kanji,accent=accent,meaningRu=ru,url=src['url']))
(root/'materials/books/editorial/official-vocabulary.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
from collections import Counter
print(len(out),dict(Counter(x['source'] for x in out)))
