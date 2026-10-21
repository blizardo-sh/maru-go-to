#!/bin/bash
set -euo pipefail
export LC_ALL=C
python3 - <<'PY'
import sqlite3,json,subprocess,tempfile,time,os,socket,shutil
from pathlib import Path
domain=Path('/etc/vpn-maintenance/panel-domain').read_text().strip()
address=os.environ['JAPANESE_PUBLIC_IPV4']
c=sqlite3.connect('file:/etc/x-ui/x-ui.db?mode=ro',uri=True)
rows=c.execute("SELECT port,settings,stream_settings FROM inbounds WHERE enable=1 AND protocol='vless'").fetchall();c.close()
runtime=json.load(open('/usr/local/x-ui/bin/config.json'))
for port,settings,stream in rows:
 settings=json.loads(settings);stream=json.loads(stream)
 if stream.get('security')!='reality':raise RuntimeError('Unexpected transport; cannot test safely')
 running=next(x for x in runtime['inbounds'] if x.get('port')==port)
 clients=running.get('settings',{}).get('clients',[])
 if not clients:raise RuntimeError('No active runtime client available on port '+str(port))
 client=clients[0];reality=running['streamSettings']['realitySettings']
 # Derive only the public key; private material never enters logs or command output.
 private=reality.get('privateKey') or reality.get('settings',{}).get('privateKey')
 try:
  import base64
  from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
  from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
  material=base64.urlsafe_b64decode(private+'='*(-len(private)%4))
  public=base64.urlsafe_b64encode(X25519PrivateKey.from_private_bytes(material).public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode().rstrip('=')
 except ImportError:
  output=subprocess.run(['/usr/local/x-ui/bin/xray-linux-amd64','x25519','-i',private],capture_output=True,text=True)
  if output.returncode:raise RuntimeError('Public-key derivation failed')
  public=None
  for line in (output.stdout+'\n'+output.stderr).splitlines():
   key,sep,value=line.partition(':')
   if 'public' in key.lower() or 'password' in key.lower():public=value.strip()
 if not public:raise RuntimeError('Could not derive public REALITY key')
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));socks_port=sock.getsockname()[1]
 config={'log':{'loglevel':'error'},'inbounds':[{'listen':'127.0.0.1','port':socks_port,'protocol':'socks','settings':{'auth':'noauth','udp':False}}],
  'outbounds':[{'protocol':'vless','settings':{'vnext':[{'address':address,'port':port,'users':[{'id':client['id'],'encryption':('none' if running['settings'].get('decryption','none')=='none' else settings.get('encryption','none')),'flow':client.get('flow','')}]}]},'streamSettings':{'network':stream.get('network','tcp'),'security':'reality','realitySettings':{'fingerprint':'chrome','serverName':reality['serverNames'][0],'publicKey':public,'shortId':reality.get('shortIds',[''])[0],'spiderX':'/'}}}]}
 work=Path(tempfile.mkdtemp(prefix='vpn-connectivity-',dir='/var/tmp'));work.chmod(0o700)
 log=work/'client.log';config['log']={'loglevel':'warning','error':str(log),'access':'none'}
 p=work/'client.json';p.write_text(json.dumps(config));p.chmod(0o600)
 process=subprocess.Popen(['/usr/local/x-ui/bin/xray-linux-amd64','run','-config',str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for attempt in range(30):
   try:
    with socket.create_connection(('127.0.0.1',socks_port),timeout=0.2):break
   except OSError:time.sleep(0.1)
  result=subprocess.run(['curl','--fail','--silent','--show-error','--max-time','25','--socks5-hostname','127.0.0.1:'+str(socks_port),'https://example.com/'],capture_output=True,text=True)
  if result.returncode and log.exists():
   import re
   for line in log.read_text(errors='replace').splitlines()[-10:]:
    line=line.replace(private,'<REDACTED>').replace(client['id'],'<REDACTED>')
    line=re.sub(r'[A-Za-z0-9_-]{40,}','<REDACTED>',line)
    print('CLIENT_SIGNAL '+line)
  if result.returncode:raise RuntimeError('VLESS end-to-end check failed on port '+str(port)+'; curl exit='+str(result.returncode)+'; detail='+result.stderr.strip()[:400])
  assert 'Example Domain' in result.stdout,'Unexpected response through VLESS'
  print('VERIFIED end-to-end VLESS/REALITY port='+str(port)+' HTTPS response=200')
 finally:
  process.terminate()
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:process.kill();process.wait()
  shutil.rmtree(work)
PY
