#!/usr/bin/env python3
"""Generate original local speech. Requires macOS Kyoko and ffmpeg; no external service.
Existing assets are reused only when their source text and tool signature match.
"""
from pathlib import Path
import json,subprocess,tempfile,hashlib,concurrent.futures,os
root=Path(__file__).resolve().parents[1];sources=json.loads((root/'materials/books/audio-source.json').read_text());out=root/'public/audio/marugoto';out.mkdir(parents=True,exist_ok=True)
manifestpath=root/'materials/books/audio-generated.json';previous=json.loads(manifestpath.read_text()) if manifestpath.exists() else {};results={}
signature='macOS-say-Kyoko-rate155/ffmpeg-aac48k-v1'
def one(entry):
 url,source=entry;path=root/'public'/url.lstrip('/');stamp=hashlib.sha256((signature+source['text']).encode()).hexdigest()
 if path.exists() and previous.get(url,{}).get('sourceHash')==stamp and previous.get(url,{}).get('duration',0)>0:return url,previous[url]
 with tempfile.TemporaryDirectory(prefix='marugoto-voice-') as temp:
  text=Path(temp)/'text.txt';aiff=Path(temp)/'voice.aiff';aac=Path(temp)/'voice.m4a';text.write_text(source['text'])
  subprocess.run(['/usr/bin/say','-v','Kyoko','-r','155','-f',str(text),'-o',str(aiff)],check=True,capture_output=True)
  subprocess.run(['/opt/homebrew/bin/ffmpeg','-v','error','-y','-i',str(aiff),'-c:a','aac','-b:a','48k','-movflags','+faststart',str(aac)],check=True,capture_output=True)
  path.write_bytes(aac.read_bytes())
 duration=float(subprocess.check_output(['/opt/homebrew/bin/ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)]).decode().strip())
 if duration<=0 or path.stat().st_size<1000:raise ValueError('Empty speech: '+url)
 return url,dict(duration=duration,sourceHash=stamp,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),bytes=path.stat().st_size,generator=signature)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for i,(url,value) in enumerate(pool.map(one,sources.items())):
  results[url]=value
  if i%100==0:
   manifestpath.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n');print(i+1,'/',len(sources),flush=True)
manifestpath.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n');print('Finished',len(results),'assets',sum(x['bytes'] for x in results.values()),'bytes')
