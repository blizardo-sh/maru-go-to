#!/usr/bin/env python3
"""Compile curated, original TSV authoring into deterministic guided routes and coverage.
Stages: pilot (A2-1 lessons 1–2 + isolated A2/B1 fixture), A2-1, A2-2, all.
No network or student database access. Audio manifest is generated for local synthesis.
"""
import json,re,hashlib,sys,copy
from pathlib import Path
root=Path(__file__).resolve().parents[1];folder=root/'materials/books';stage=sys.argv[1] if len(sys.argv)>1 else 'all'
read=lambda p:json.loads((folder/p).read_text());structure=read('structure.json');coverage=read('coverage.json');vocab=read('vocabulary.json');mapping=read('editorial/vocabulary-map.json')
books={'A2-1':'marugoto.elementary1-a2','A2-2':'marugoto.elementary2-a2','A2B1':'marugoto.pre-intermediate-a2b1'}
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()[:16]
write=lambda p,v:p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
# Words/forms from A1 overlays must retain their identities in the main lesson material.
base=json.loads((root/'materials/course.json').read_text());baseSkills={s['id']:s for s in base['skills']};words={w['id']:w for w in base['words']}
for p in sorted((root/'materials/learning').glob('lesson-*.json')):
 authored=json.loads(p.read_text()).get('authored',{});words.update({w['id']:w for w in authored.get('words',[])});baseSkills.update({s['id']:s for s in authored.get('skills',[])})
words.update({w['id']:w for w in vocab['words']});targets=dict(words)
for m in vocab['meanings']:targets[m['id']]={**words[m['wordId']],**m,'lexemeId':m['wordId'],'audioUrl':m['context']['audioUrl']}
material={k:{} for k in ['words','forms','skills','exercises']};audio={}
def tagged(s):
 segments=[];pos=0
 for m in re.finditer(r'([^\[\]]+)\[([^\[\]]+)\]',s):
  # The preceding text can include kana/punctuation before a kanji run. Only the trailing non-kana run is ruby.
  raw=m[1];cut=len(raw)
  while cut>0 and re.match('[一-龯々ヶ]',raw[cut-1]):cut-=1
  prefix=raw[:cut];surface=raw[cut:]
  if not surface:surface=raw;prefix=''
  if prefix:segments.append({'surface':prefix})
  segments.append({'surface':surface,'reading':m[2]});pos=m.end()
 if pos<len(s):segments.append({'surface':s[pos:]})
 if not segments:segments=[{'surface':s}]
 surface=''.join(x['surface'] for x in segments);kana=''.join(x.get('reading',x['surface']) for x in segments)
 assert not re.search(r'[一-龯々\[\]]',kana),(s,kana)
 return dict(surface=surface,kana=kana,segments=segments)
def example(jp,ru):
 v=tagged(jp);path='/audio/marugoto/'+sha(v['kana'])+'.m4a';audio[path]=dict(text=v['surface'],reading=v['kana'],origin='original-authoring');return dict(**v,meaningRu=ru,audioUrl=path)
grammar={}
for line in (folder/'editorial/grammar.tsv').read_text().splitlines():
 if not line or line.startswith('#'):continue
 row,jp,ru,explanation=line.split('|');grammar[int(row)]=(jp,ru,explanation)
assert len(grammar)==196
a1Skills={59:'ni_residence',60:'de_activity_place',61:'route_transport',69:'ga_liking',71:'kara_reason',72:'adjective_past',73:'adjective_past',74:'verb_past',95:'ni_purpose',96:'ni_purpose',101:'tai_desire',128:'ageru',129:'morau',219:'kara_reason',225:'kara_reason'}
patternSkills={}
for item in coverage['grammar']:
 row=item['sourceRow'];pattern=item['pattern']
 semantic='appearance' if row in [110,111,140,141] else 'hearsay' if row in [188,200,247] else str(row) if row in [58,60,61,75,77,78,89,138,172,173,195,235,245] else pattern
 if row in a1Skills:id='marugoto.starter-a1.skill.'+a1Skills[row]
 else:
  id=patternSkills.setdefault(semantic,'marugoto.grammar.'+sha(semantic))
 item['sharedSkillId']=id
alltasks={}
for line in (folder/'editorial/tasks.tsv').read_text().splitlines():
 if not line or line.startswith('#'):continue
 tag,n,mode,instruction,jp,ru,question,correct,wrong=line.split('|');book=books[tag];n=int(n);entry=next(x for x in coverage['canDo'] if x['bookId']==book and x['canDoId']==n)
 v=example(jp,ru);id=f'{book}.cando.{n:02}';task=dict(id=id,titleRu={'spoken':'Собственный устный ответ','written':'Письменный ответ','reading':'Читаем и понимаем','listening':'Слушаем и понимаем'}[mode],instructionRu=instruction,canDoIds=[n])
 if mode in ['reading','listening']:task.update(kind=mode,passage=[v],questionRu=question,options=[dict(id='a',text=correct),dict(id='b',text=wrong)],acceptedAnswers=['a'],explanationRu=ru)
 if tag=='A2-2' and n==6:task.update(layout='vertical-menu',passage=[example(a,b) for a,b in zip(jp.rstrip('。').split('。'),ru.rstrip('.').split('. '))])
 if mode in ['reading','listening'] and int(sha(id),16)%2:task['options'].reverse()
 if mode not in ['reading','listening']:task.update(kind='production',response=mode,supports=[instruction,'Сначала подготовьте свой вариант. Затем откройте образец и сравните смысл.'],model=v,rubric=['Задача выполнена: '+instruction,'Смысл понятен собеседнику; имена, время и причины не противоречат друг другу.','Формы и вежливость подходят ситуации. Отличия от образца допустимы.'])
 alltasks[(book,n)]=task;entry.update(tasks=[id],status='authored-awaiting-language-review')
assert len(alltasks)==146
for lesson in structure['lessons']:
 if lesson['bookId']==books['A2B1']:
  lesson['title']=['Спортивный матч','Ищем жильё','Привычная еда','Принимаем гостей','Радость изучения языка','Свадьба','Обсуждаем проблемы','Трудности в путешествии','Ищем работу'][lesson['number']-1]
 refs=lesson['sourceRefs'];book=lesson['bookId'];lid=lesson['id'];goals=[];used=set();route=dict(lessonId=lid,version='marugoto-a2-v1',titleRu=lesson['title'],goals=goals)
 unitrows=[x for x in coverage['grammar'] if x['lessonId']==lid]
 examples=[]
 for item in unitrows:
  row=item['sourceRow'];jp,ru,explanation=grammar[row];v=example(jp.replace('/','')+'。',ru);examples.append(v)
  skillid=item['sharedSkillId'];exerciseid=f'{book}.example.grammar.{row}';tokens=[]
  for i,chunk in enumerate(jp.split('/')):
   value=tagged(chunk);wid='marugoto.fragment.'+sha(value['surface']+'|'+value['kana']);fid=wid+'.form'
   if wid not in material['words']:
    material['words'][wid]=dict(id=wid,lessonIds=[],**value,meaningRu='Фрагмент конструкции: '+ru,kind='phrase',pos='other',trainingOnly=True,reviewStatus='source-checked',sourceRefs=refs)
    material['forms'][fid]=dict(id=fid,wordId=wid,lessonIds=[],**value,reviewStatus='source-checked',sourceRefs=refs)
   for kind,id in [('words',wid),('forms',fid)]:
    if lid not in material[kind][id]['lessonIds']:material[kind][id]['lessonIds'].append(lid)
   tokens.append(dict(id=f't{i+1}',formId=fid))
  if skillid not in material['skills']:
   skill=copy.deepcopy(baseSkills[skillid]) if skillid in baseSkills else dict(id=skillid,lessonIds=[],canDoIds=[],canDoRefs=[],title=item['pattern'],explanationRu=explanation,reviewStatus='source-checked',sourceRefs=[])
   if 'canDoRefs' not in skill:skill['canDoRefs']=[dict(bookId='marugoto.starter-a1',number=n) for n in skill['canDoIds']]
   material['skills'][skillid]=skill
  skill=material['skills'][skillid]
  if lid not in skill['lessonIds']:skill['lessonIds'].append(lid)
  for n in lesson['canDoIds']:
   ref=dict(bookId=book,number=n)
   if ref not in skill['canDoRefs']:skill['canDoRefs'].append(ref)
  skill['sourceRefs'].append(dict(part='combined' if book==books['A2B1'] else 'rikai',url='https://marugoto.jpf.go.jp/en/teacher/resource/',row=row,label='Grammar index; original example and explanation'))
  material['exercises'][exerciseid]=dict(id=exerciseid,lessonId=lid,skillId=skillid,promptRu=ru,translationRu=ru,contextRu='Соберите фразу для этой ситуации: '+ru,tokens=tokens,acceptedOrders=[[t['id'] for t in tokens]],sentenceEnd='。',reviewStatus='source-checked')
  goal=dict(id=f'{lid}.grammar.{row}',titleRu=item['pattern'],introductionRu=explanation,canDoIds=lesson['canDoIds'],parts=[dict(id=f'{lid}.part.grammar.{row}',words=[],construction=dict(exerciseId=exerciseid,explanationRu=explanation,example=v,breakdown=[dict(text=tagged(chunk)['surface'],explanationRu=explanation if i==len(tokens)-1 else 'Смысловой фрагмент: '+ru) for i,chunk in enumerate(jp.split('/'))]))])
  goals.append(goal);item.update(skills=[skillid],exercises=[exerciseid],status='authored-awaiting-language-review')
 unitTasks=[alltasks[(book,n)] for n in lesson['canDoIds']]
 examples += [t['model'] if t['kind']=='production' else t['passage'][0] for t in unitTasks]
 # Main vocabulary is selected only when it occurs in an authored situational example.
 eligible=[]
 ids=list(dict.fromkeys(m['targetId'] for m in mapping if m['lessonId']==lid))
 for id in ids:
  w=targets[id];context=next((e for e in examples if len(w['kana'])>=2 and (w['surface'] in e['surface'] or w['kana'] in e['kana'])),None)
  if context and len(w['kana'])>=2 and not re.search('фамилия|имя|суффикс|междомет',w['meaningRu'],re.I):eligible.append((id,context))
 eligible.sort(key=lambda x:(x[0].startswith('marugoto.starter'),-len(targets[x[0]]['kana'])))
 selected=eligible[:15]
 for offset in range(0,len(selected),5):
  introductions=[]
  for id,ex in selected[offset:offset+5]:
   w=targets[id];intro=dict(wordId=id,explanationRu='В этой ситуации: '+w['meaningRu'],example=w.get('context',ex));introductions.append(intro);used.add(id)
  goals.insert(offset//5,dict(id=f'{lid}.words.{offset//5+1}',titleRu='Слова в ситуации',introductionRu='Послушайте слова, прочитайте пример и свяжите значение с ситуацией.',canDoIds=lesson['canDoIds'],parts=[dict(id=f'{lid}.part.words.{offset//5+1}',words=introductions)]))
 for task in unitTasks:goals.append(dict(id=task['id']+'.goal',titleRu=task['titleRu'],canDoIds=task['canDoIds'],parts=[dict(id=task['id']+'.part',words=[],tasks=[task])]))
 enabled=stage=='all' or stage=='A2-2' and book!=books['A2B1'] or stage=='A2-1' and book==books['A2-1'] or stage=='pilot' and book==books['A2-1'] and lesson['number']<=2
 lesson['availability']='full' if enabled else 'preparing';lesson['readiness']={k:'source-checked' if enabled else 'missing' for k in ['vocabulary','grammar','exercises','audio']}
 directory=folder/book/'learning';directory.mkdir(parents=True,exist_ok=True);path=directory/f'{"topic" if book==books["A2B1"] else "lesson"}-{lesson["number"]:02}.json'
 if enabled:write(path,route)
 elif path.exists():path.unlink()
 if book==books['A2B1'] and lesson['number']==1:write(root/'verification/marugoto-a2/pilot-a2b1.json',route)
for w in vocab['words']:
 if w.get('audioUrl','').startswith('/audio/marugoto/'):audio[w['audioUrl']]=dict(text=w['surface'],reading=w['kana'],origin='dictionary-pronunciation')
for m in vocab['meanings']:
 c=m['context'];audio[c['audioUrl']]=dict(text=c['surface'],reading=c['kana'],origin='original-meaning-context')
write(folder/'curriculum.json',{k:list(v.values()) for k,v in material.items()});write(folder/'structure.json',structure);write(folder/'coverage.json',coverage);write(folder/'audio-source.json',audio)
print(stage, sum(l['availability']=='full' for l in structure['lessons']),'new routes;',len(alltasks),'tasks;',len(grammar),'grammar rows;',len(audio),'audio assets')
