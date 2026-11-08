#!/usr/bin/env python3
"""Deterministic dictionary merge. IDs are content keys; old default targets are immutable.
Run after extract-marugoto-vocabulary.py. See editorial/sense-rules.json for reviewed distinctions.
"""
import json,re,hashlib,unicodedata,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];folder=root/'materials/books'
read=lambda p:json.loads((root/p).read_text())
base=read('materials/course.json')
# Apply the existing authored A1 overlays exactly as the runtime does.
for path in sorted((root/'materials/learning').glob('lesson-*.json')):
 for kind,entries in json.loads(path.read_text()).get('authored',{}).items():
  byid={v['id']:v for v in base[kind]};byid.update({v['id']:v for v in entries});base[kind]=list(byid.values())
rows=read('materials/books/editorial/official-vocabulary.json');rules=read('materials/books/editorial/sense-rules.json')
words={w['id']:w for w in base['words']};forms={f['id']:f for f in base['forms']};original=json.loads(json.dumps(words));meanings={};mapping=[];index={};existing_forms={}
for f in forms.values():existing_forms.setdefault(f['kana'],[]).append(f)
def clean(v):return unicodedata.normalize('NFKC',v).strip()
def key(v):return re.sub(r'[\s、。・〜～~()（）0-9１２３]','',clean(v))
def family(kana,ru):
 for rule in rules.get(kana,[]):
  if re.search(rule['match'],ru,re.I):return rule['sense']
 return 'default'
def identity(kana,ru):
 f=family(kana,ru)
 rule=next((r for r in rules.get(kana,[]) if r['sense']==f),{})
 return kana,rule.get('lexeme','shared'),f
for w in words.values():
 k=key(w['kana']);i=identity(k,w['meaningRu']);index.setdefault(i,w['id'])
 # An old combined meaning remains one target for every sense it already teaches.
 for rule in rules.get(k,[]):
  if re.search(rule['match'],w['meaningRu'],re.I):index.setdefault((k,rule.get('lexeme','shared'),rule['sense']),w['id'])
lexemes={k[:2]:target for k,target in index.items()}
def digest(text):return hashlib.sha256(text.encode()).hexdigest()[:16]
def normal(row):
 raw=re.sub('【.*?】','',row['entry']);raw=re.sub(r'[（(]([がをにでと])[）)]',r'\1',raw);raw=re.sub(r'[（(].*?[）)]','',raw);raw=re.split('[／/、]',raw)[0];kana=re.sub(r'[\s１２３123～〜]','',raw)
 kana=kana.replace('（','').replace('）','')
 if not re.fullmatch('[ぁ-ゖァ-ヺー・]+',kana):
  a=re.split('[／/（(、]',row['accent'])[0];a=re.sub(r'[￢￣¬\s～〜―]','',a)
  if re.fullmatch('[ぁ-ゖァ-ヺー・]+',a):kana=a
 if not re.fullmatch('[ぁ-ゖァ-ヺー・]+',kana):raise ValueError((row,kana))
 surface=re.split('[／/、]',row['kanji'])[0].strip('（）() ') or kana
 # A complete reading segment is valid even when the dictionary gives no word-level ruby split.
 ru=row['meaningRu'].replace('\\',' / ').strip()
 if kana=='すずき':ru='Судзуки (японская фамилия)'
 if kana=='つれていきます':ru='брать кого-либо с собой'
 if kana=='どれ':ru='который (из трёх и более)'
 if kana=='にじょうじょう':ru='замок Нидзё'
 if kana=='まこと':ru='Макото (японское личное имя)'
 return surface,kana,ru
for n,row in enumerate(rows):
 surface,kana,ru=normal(row);k=key(kana);ident=identity(k,ru);target=index.get(ident);lexeme=lexemes.get(ident[:2]);lesson=row['lessonId']
 source=dict(part='combined' if row['source']=='a2b1' else 'rikai' if row['source'].endswith('-c') else 'katsudoo',url=row['url'],page=row['page'],row=row['row'],entry=row['entry'])
 if not target:
  if not lexeme:
   target=lexeme='marugoto.word.'+digest('|'.join(ident[:2]));segments=[dict(surface=surface,**({'reading':kana} if surface!=kana else {}))]
   words[lexeme]=dict(id=lexeme,lessonIds=[],surface=surface,kana=kana,meaningRu=ru,segments=segments,kind='word',pos='verb' if kana.endswith('ます') else 'other',reviewStatus='source-checked',sourceRefs=[])
   forms[lexeme+'.form']=dict(id=lexeme+'.form',wordId=lexeme,lessonIds=[],surface=surface,kana=kana,segments=segments,reviewStatus='source-checked',sourceRefs=[])
   lexemes[ident[:2]]=lexeme
  else:
   target='marugoto.meaning.'+digest('|'.join(ident));rule=next(r for r in rules[k] if r['sense']==ident[2]);context=rule['context'];jp,reading,translation=context
   meanings[target]=dict(id=target,wordId=lexeme,lessonIds=[],meaningRu=rule.get('meaningRu',ru),context=dict(surface=jp,kana=reading,segments=[dict(surface=jp,reading=reading)],meaningRu=translation,audioUrl='/audio/marugoto/'+digest(reading)+'.m4a'),reviewStatus='source-checked',sourceRefs=[])
   if 'defaultLessonIds' not in words[lexeme]:words[lexeme]['defaultLessonIds']=list(words[lexeme]['lessonIds'])
  index[ident]=target
 lexeme=meanings[target]['wordId'] if target in meanings else target
 w=words[lexeme]
 if w['reviewStatus']=='draft':w['reviewStatus']='source-checked'
 if lesson not in w['lessonIds']:w['lessonIds'].append(lesson)
 if target in meanings:record=meanings[target]
 else:
  record=w
  if 'defaultLessonIds' in w and lesson not in w['defaultLessonIds']:w['defaultLessonIds'].append(lesson)
 if lesson not in record['lessonIds']:record['lessonIds'].append(lesson)
 if source not in record['sourceRefs']:record['sourceRefs'].append(source)
 # Existing forms remain stable. Add memberships only to their lexical default form.
 form=next(f for f in forms.values() if f['wordId']==lexeme and f['surface']==w['surface'] and f['kana']==w['kana'])
 if lesson not in form['lessonIds']:form['lessonIds'].append(lesson)
 if not form['sourceRefs']:form['sourceRefs']=[source]
 w.setdefault('audioUrl','/audio/marugoto/'+digest(w['kana'])+'.m4a')
 mapping.append(dict(source=row['source'],page=row['page'],row=row['row'],entry=row['entry'],lessonId=lesson,wordId=lexeme,targetId=target,decision='existing' if lexeme in original else 'new-lexeme' if target==lexeme else 'new-meaning'))
# Explicit part-of-speech curation enables the shared noun builder without guessing ambiguous entries.
parts=json.loads((folder/'editorial/parts-of-speech.json').read_text())
for word in words.values():
 if word['id'] in original:continue
 for pos,entries in parts.items():
  if word['kana'] in entries:word['pos']=pos
# Material is an overlay, never a rewrite of A1 inputs.
overlay=dict(words=[w for id,w in words.items() if id not in original or w!=original[id]],forms=[f for f in forms.values() if f not in base['forms']],meanings=list(meanings.values()))
# Forms mutated in place above: include their changed references explicitly.
overlay['forms']=[f for f in forms.values() if any(l.startswith(('marugoto.elementary','marugoto.pre-intermediate')) for l in f['lessonIds'])]
for name,value in [('vocabulary.json',overlay),('editorial/vocabulary-map.json',mapping)]: (folder/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(len(rows),'source rows;',len(words)-len(original),'new lexemes;',len(meanings),'new meanings')
