#!/usr/bin/env python3
"""Extract book/Can-do membership and grammar row references from verified local sources.

Usage: python3 scripts/prepare-marugoto-sources.py SOURCE_CACHE GRAMMAR_XLSX
Only provenance and factual structure are written; official texts/audio stay in the cache.
"""
import hashlib,json,re,subprocess,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as E
root=Path(__file__).resolve().parents[1]
cache,grammar=map(Path,sys.argv[1:3])
manifest=json.loads((cache/'manifest.json').read_text())
expected=json.loads((root/'docs/research/marugoto-a2-grammar-evidence-2026-11-06.json').read_text())
assert hashlib.sha256(grammar.read_bytes()).hexdigest()==expected['source_sha256']
n={'x':'http://www.w3.org/1999/xhtml'}
books=[
 ('a2-1','marugoto.elementary1-a2','Marugoto Elementary 1 · A2-1','A2-1',18,53,'初級1(りかい)'),
 ('a2-2','marugoto.elementary2-a2','Marugoto Elementary 2 · A2-2','A2-2',18,49,'初級2(りかい)'),
 ('a2b1','marugoto.pre-intermediate-a2b1','Marugoto Pre-Intermediate · A2/B1','A2/B1',9,44,'初中級'),
]
titles=[
 ['Жизнь и работа моей семьи','Рассказываем об увлечениях','Времена года','Разговор о погоде','Места в моём городе','Объясняем дорогу','Договариваемся о встрече','Приглашаем на прогулку','Опыт изучения языков','Знакомство с другой культурой','Планируем пикник','Угощаем и обсуждаем еду','Встречаем коллегу','В гостях в офисе','Советы о самочувствии','Привычки для здоровья','Подарки и поздравления','Планируем праздник'],
 ['Знакомство и имена','Описываем человека','Выбираем блюдо','Как приготовить и съесть','Собираемся в поездку','Возможности на отдыхе','План на случай дождя','Встречаемся на мероприятии','Новогодние впечатления','Пожелания и праздники','Объясняем поломку','Сравниваем покупки','Знакомимся с историей места','Искусство и впечатления','Экономим ресурсы','Вторая жизнь вещей','Человек, которым восхищаюсь','Воспоминания о детстве'],
 ['Спортивный матч','Ищем жильё','Любимая домашняя еда','Принимаем гостей','Изучаем язык','Питаемся вне дома','Путешествуем','Жизнь и здоровье','Ищем работу'],
]
metadata=[];lessons=[];coverage=[]
for index,(tag,book_id,title,short,count,goal_count,label) in enumerate(books):
 source=next(s for s in manifest if s['file']==tag+'-cando.pdf');pdf=cache/source['file']
 assert hashlib.sha256(pdf.read_bytes()).hexdigest()==source['sha256']
 out=pdf.with_suffix('.html');subprocess.run(['pdftotext','-bbox-layout',str(pdf),str(out)],check=True)
 doc=E.fromstring(re.sub('[\x00-\x08\x0b\x0c\x0e-\x1f]',' ',out.read_text()))
 units=[]
 for pi,page in enumerate(doc.findall('.//x:page',n)):
  words=[(float(w.attrib['xMin']),float(w.attrib['yMin']),w.text or '') for w in page.findall('.//x:word',n)]
  left,right=(90,100) if count==18 else (30,40);cl,cr=(208,220) if count==18 else (236,244)
  numbers=sorted((y,int(t)) for x,y,t in words if left<=x<=right and t.isascii() and t.isdigit())
  for i,(y,number) in enumerate(numbers):
   end=numbers[i+1][0] if i+1<len(numbers) else 570
   ids=[int(t) for x,yy,t in sorted(words,key=lambda w:w[1]) if cl<=x<=cr and y-2<=yy<end and t.isascii() and t.isdigit()]
   units.append((number,ids,pi+1))
 assert sorted(x[0] for x in units)==list(range(1,count+1)),tag
 assert sorted(g for _,ids,_ in units for g in ids)==list(range(1,goal_count+1)),tag
 unit='lesson' if count==18 else 'topic'
 metadata.append(dict(id=book_id,title=title,shortTitle=short,level='A2' if count==18 else 'A2/B1',order=index+1,unit=unit,unitCount=count,canDoCount=goal_count))
 for number,ids,page in units:
  lesson_id=f'{book_id}.{unit}.{number:02}'
  lessons.append(dict(id=lesson_id,bookId=book_id,number=number,title=titles[index][number-1],topic=f'Тема {(number+1)//2 if count==18 else number}',canDoIds=ids,sourceRefs=[dict(part='katsudoo' if count==18 else 'combined',url=source['url'],page=page)],availability='preparing',readiness=dict(vocabulary='missing',grammar='missing',exercises='missing',audio='missing')))
  coverage.extend(dict(bookId=book_id,lessonId=lesson_id,canDoId=g,source={'url':source['url'],'page':page},tasks=[],status='pending') for g in ids)
z=zipfile.ZipFile(grammar);ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
ss=[''.join(t.text or '' for t in s.findall('s:t',ns)+s.findall('s:r/s:t',ns)) for s in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
rows=[]
for r in E.fromstring(z.read('xl/worksheets/sheet2.xml')).findall('.//s:row',ns):
 cells={re.sub(r'\d','',c.attrib['r']):ss[int(c.find('s:v',ns).text)] if c.attrib.get('t')=='s' else c.find('s:v',ns).text if c.find('s:v',ns) is not None else '' for c in r}
 if not cells.get('A','').isdigit():continue
 for tag,book_id,_,_,count,_,label in books:
  if cells.get('F')!=label:continue
  number=int(re.search(r'\d+',cells['H' if count==18 else 'G']).group())
  rows.append(dict(bookId=book_id,lessonId=f'{book_id}.{"lesson" if count==18 else "topic"}.{number:02}',sourceRow=int(r.attrib['r']),sourceNumber=int(cells['A']),pattern=cells.get('B',''),status='pending',skills=[]))
assert len(rows)==196,(len(rows),rows[:2])
for (_,book_id,_,_,_,_,_),wanted in zip(books,[75,78,43]):assert sum(r['bookId']==book_id for r in rows)==wanted
write=lambda name,v:(root/'materials/books'/name).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
write('structure.json',dict(books=metadata,lessons=lessons))
write('source-manifest.json',dict(checkedAt='2026-11-06',policy='Original Japanese examples, Russian explanations and locally generated audio only. Official files used for verification; linked, not redistributed.',sources=manifest+[dict(file='grammar.xlsx',url=expected['source_url'],sha256=expected['source_sha256'],bytes=expected['source_bytes'],use='Structure and grammar references only')]))
write('coverage.json',dict(canDo=coverage,grammar=rows))
print(f'{len(lessons)} units; {len(coverage)} Can-do references; {len(rows)} grammar rows')
