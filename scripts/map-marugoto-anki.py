#!/usr/bin/env python3
"""Compare the user-provided Anki table with official rows; never import its media."""
import json,sys,hashlib,re,unicodedata
from pathlib import Path
root=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]);notes=json.loads(source.read_text());maps=json.loads((root/'materials/books/editorial/vocabulary-map.json').read_text());rows=json.loads((root/'materials/books/editorial/official-vocabulary.json').read_text());books={'A2-1':'marugoto.elementary1-a2','A2-2':'marugoto.elementary2-a2','A2-B1':'marugoto.pre-intermediate-a2b1'}
def norm(v):
 v=unicodedata.normalize('NFKC',v);v=re.sub('【.*?】','',v);v=re.sub(r'\(([がをにでと])\)',r'\1',v);v=re.sub(r'\(.*?\)','',v);return re.sub('[１２３123～〜\\s]','',re.split('[／/、]',v)[0])
decisions=json.loads((root/'materials/books/editorial/anki-decisions.json').read_text())
result=[]
for n in notes:
 if n['book'] not in books:continue
 book=books[n['book']];lesson=int(n['lesson']);lid=f'{book}.{"topic" if n["book"]=="A2-B1" else "lesson"}.{lesson:02}';key=norm(n['japanese'])
 options=[(r,m) for r,m in zip(rows,maps) if m['lessonId']==lid and norm(r['entry'])==key]
 if not options:options=[(r,m) for r,m in zip(rows,maps) if m['lessonId'].startswith(book) and norm(r['entry'])==key]
 ids=sorted(set(m['targetId'] for r,m in options))
 # Explicit lexeme/meaning choices can be edited in this checked mapping; ambiguity never creates another card.
 result.append(dict(sourceGuid=n['sourceGuid'],sourceNoteId=n['sourceNoteId'],bookId=book,lessonId=lid,japanese=n['japanese'],english=n['english'],russian=n['russian'],candidateTargetIds=ids,status='matched' if len(ids)==1 else 'ambiguous' if ids else 'unmatched'))
for entry in result:
 decision=decisions.get(entry['sourceGuid'])
 if decision:
  assert decision['targetId'] in entry['candidateTargetIds'];entry.update(targetId=decision['targetId'],status='editorially-resolved',decision=decision['reason'])
 elif len(entry['candidateTargetIds'])==1:entry['targetId']=entry['candidateTargetIds'][0]
 assert entry.get('targetId'),entry
out=dict(sourceFile=source.name,sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),mediaImported=False,entries=result)
(root/'materials/books/editorial/anki-map.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
from collections import Counter
print(dict(Counter(x['status'] for x in result)))
for x in result:
 if x['status'] not in ['matched','editorially-resolved']:print(x['bookId'].split('.')[-1],x['lessonId'][-2:],x['japanese'],x['english'],x['status'])
