"""Compile editable source tables against a prepared base Course; no runtime AI."""
import hashlib,json,re,sys,unicodedata
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=json.loads((root/'materials/thematic-sources.json').read_text())
course=json.loads(Path(sys.argv[1]).read_text())
catalog=json.loads((root/'materials/catalog.json').read_text())
words={w['id']:w for w in course['words']}; added=[]; forms=[]; entries=[]; pools={}; labels={}
normal=lambda text: re.sub(r'[\s。、？！!?〜～]','',text)
audio=lambda text:'/audio/'+hashlib.sha256(('Kyoko:150:'+text).encode()).hexdigest()[:20]+'.m4a'
refs=lambda keys:[{'part':'rikai','url':source['sources'][key]['url'],'label':source['sources'][key]['title']} for key in keys]

def add(record,key):
    candidates=[w for w in words.values() if normal(w['kana'])==normal(record['kana']) and not w['id'].startswith('training.')]
    candidates.sort(key=lambda w:(('marugoto.starter-a1.lesson.%02d'%record.get('lessonNumber',12)) not in w['lessonIds'],w['reviewStatus']=='draft'))
    if record.get('wordId'):
        word=words[record['wordId']]
        assert normal(word['kana'])==normal(record['kana']), 'Canonical reading changed: '+word['id']
    else:
        assert len(candidates)<=1, 'Ambiguous canonical word; set wordId in the source'
        word=candidates[0] if candidates else None
    if not word:
        identifier='training.'+key
        text=normal(record.get('audioText') or record.get('exampleAudioText') if '〜' in record['kana'] else record.get('audioText') or record['kana'])
        text=record.get('audioText') or text
        word={'id':identifier,'lessonIds':['marugoto.starter-a1.lesson.%02d'%record.get('lessonNumber',12)],'surface':record.get('surface') or record['kana'],'kana':record['kana'],'meaningRu':record['meaningRu'],'segments':record.get('segments') or [{'surface':record.get('surface') or record['kana'],'reading':record['kana']}],'kind':'phrase' if key.startswith('clock.') or record.get('id') in ['origin','destination','age-polite','how-was','name','meaning','month-day'] else 'word','pos':'expression','reviewStatus':'source-checked','sourceRefs':refs(record['sources']),**({'trainingOnly':True} if key.startswith('clock.') else {}),'audioUrl':audio(text),'audioText':re.sub(r'[。、？！!?〜～]','',text)}
        # The pronunciation hash must use the same explicit text as the recorded word.
        word['audioUrl']=audio(word['audioText']);words[identifier]=word;added.append(word)
        forms.append({k:v for k,v in word.items() if k in ['lessonIds','surface','kana','segments','reviewStatus','sourceRefs']}|{'id':identifier+'.form','wordId':identifier})
    entry={'wordId':word['id'],'explanationRu':record['explanationRu'],'sectionId':record['sectionId'],'choiceGroup':record.get('choiceGroup',record['sectionId'])}
    if record.get('exampleKana'):
        text=record['exampleKana'];spoken=record.get('exampleAudioText',text)
        entry['example']={'surface':text,'kana':text,'segments':[{'surface':text}],'meaningRu':record['exampleMeaningRu'],'audioText':spoken,'audioUrl':audio(spoken)}
    if record.get('applicationPromptRu'):entry['application']={'promptRu':record['applicationPromptRu'],'choices':[]}
    if record.get('visual'):entry['visual']=record['visual']
    entries.append(entry);pools.setdefault(entry['choiceGroup'],[]).append(word['id'])
    if record.get('applicationLabel'):labels[word['id']]=record['applicationLabel']
    return word

for key in ['questions','relativeTime','recurrence','partsOfDay','amPm','weekdays','months','calendarDates']:
    for record in source[key]:
        if record.get('mergeWith'):continue
        record=dict(record)
        if key in ['months','calendarDates']:record['visual']={'kind':'calendar','value':record['value'],'label':'Месяц' if key=='months' else 'Число месяца'}
        add(record,key+'.'+str(record['id'] if 'id' in record else record['value']))

for period in source['amPm']:
 for hour in source['hours']:
  for minute in source['minutes']:
    h,m=hour['value'],minute['value'];hr=source['templates']['clockZero'] if h==12 else hour
    surface=period['surface']+hr['surface']+(minute['surface'] if m else '')
    kana=period['kana']+hr['kana']+(minute['kana'] if m else '')
    meaning=source['templates']['clockMeaning'].format(time=f'{h%12+(12 if period["id"]=="pm" else 0):02}:{m:02}',period=source['periodLabels'][period['id']])
    record={'surface':surface,'kana':kana,'meaningRu':meaning,'sectionId':'clock','choiceGroup':'clock.'+period['id'],'lessonNumber':9,'sources':['time','minutes','madrid'],'explanationRu':source['templates']['clockExplanation'].format(meaning=meaning),'applicationPromptRu':source['templates']['clockScenario'],'visual':{'kind':'clock','hour':h,'minute':m,'period':period['id']},'segments':[{'surface':part['surface'],'reading':part['kana']} for part in [period,hr]+([minute] if m else [])]}
    add(record,f'clock.{period["id"]}.{h:02}.{m:02}')

# Semantic exclusions and ready statuses follow the existing authored-choice policy.
def normalized(text):
 return ''.join(c for c in unicodedata.normalize('NFKC',text).lower() if not c.isspace() and unicodedata.category(c)[0] not in ['P','S'])
def reading(text):
 return ''.join(chr(ord(c)-96) if 'ァ'<=c<='ヶ' else c for c in normalized(text))
def meanings(word):
 values=[normalized(part) for part in re.split('[,;/]',re.sub(r'\([^)]*\)','',word['meaningRu'].lower()))];values=[v for v in values if v]
 if any(value not in catalog['quiz']['courtesyMarkers'] for value in values):values=[value for value in values if value not in catalog['quiz']['courtesyMarkers']]
 return set(values)
def confusable(a,b):
 if a['id']==b['id'] or normalized(a['surface'])==normalized(b['surface']) or reading(a.get('audioText') or a['kana'])==reading(b.get('audioText') or b['kana']) or meanings(a)&meanings(b):return True
 spell=lambda w:{normalized(w['surface']),reading(w['kana']),reading(w.get('audioText') or w['kana'])}
 return any(spell(a)&{reading(v) for v in group} and spell(b)&{reading(v) for v in group} for group in catalog['quiz']['equivalent'])
clock_ids={(e['visual']['period'],e['visual']['hour'],e['visual']['minute']):e['wordId'] for e in entries if e.get('visual',{}).get('kind')=='clock'}
choices={};seen=set();unique=[]
for entry in entries:
 if entry['wordId'] in seen:continue
 seen.add(entry['wordId']);unique.append(entry)
entries=unique
for entry in entries:
 target=words[entry['wordId']];group=pools[entry['choiceGroup']]
 candidates=[words[id] for id in dict.fromkeys(group) if words[id]['kind']==target['kind'] and words[id]['reviewStatus']!='draft']
 if len(candidates)<4:candidates=[w for w in words.values() if w['id'] in catalog['quiz']['choices'] and w['kind']==target['kind'] and w['reviewStatus']!='draft']
 seed=int(hashlib.sha256(target['id'].encode()).hexdigest()[:8],16)
 candidates=candidates[seed%len(candidates):]+candidates[:seed%len(candidates)]
 selected=[target]
 visual=entry.get('visual',{})
 if visual.get('kind')=='clock':
  period,hour,minute=visual['period'],visual['hour'],visual['minute']
  other_period=next(value['id'] for value in source['amPm'] if value['id']!=period)
  candidates=[words[clock_ids[key]] for key in [(period,hour,minute+1 if minute<59 else minute-1),(period,hour%12+1,minute),(other_period,hour,minute)]]
 for candidate in candidates:
  if all(not confusable(candidate,previous) for previous in selected):selected.append(candidate)
  if len(selected)==4:break
 if len(selected)!=4:raise ValueError('No choices: '+target['id'])
 choices[target['id']]=[w['id'] for w in selected[1:]]
 if 'application' in entry:
  entry['application']['choices']=choices[target['id']]
  if target['id'] in labels:
   entry['application']['labels']={w['id']:{'surface':labels.get(w['id'],w['surface']),'kana':labels.get(w['id'],w['kana']),'segments':[{'surface':labels.get(w['id'],w['surface']),**({'reading':labels.get(w['id'],w['kana'])} if labels.get(w['id'],w['surface'])!=labels.get(w['id'],w['kana']) else {})}]} for w in selected}
 entry.pop('choiceGroup',None)
sections=[]
for raw in source['sections']:
 ids=[entry['wordId'] for entry in entries if entry['sectionId']==raw['id']]
 sections.append({'id':raw['id'],'topic':raw['topic'],'title':raw['title'],'referenceRu':source['templates'][raw['referenceKey']],'wordIds':ids,**({'variable':True} if raw.get('variable') else {})})
for entry in entries:entry.pop('sectionId',None)
result={'version':source['version'],'words':added,'forms':forms,'entries':entries,'sections':sections,'choices':choices}
(root/'materials/thematic-training.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'wordsAdded':len(added),'entries':len(entries),'sections':[(s['id'],len(s['wordIds'])) for s in sections]},ensure_ascii=False))
