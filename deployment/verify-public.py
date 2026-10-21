#!/usr/bin/env python3
"""Public, non-destructive checks; never registers users or reads credentials."""
import concurrent.futures,json,sys,time,urllib.error,urllib.request
from urllib.parse import urlsplit
assert len(sys.argv)==2, 'Usage: python3 deployment/verify-public.py https://your-origin'
SITE=sys.argv[1].rstrip('/')
origin=urlsplit(SITE)
assert origin.scheme=='https' and origin.hostname and origin.username is None and origin.password is None and not origin.path and not origin.query and not origin.fragment, 'Use an HTTPS origin without credentials or a path' 
def request(path,body=None,headers=None):
    req=urllib.request.Request(SITE+path,data=body,headers=headers or {})
    try:
        with urllib.request.urlopen(req,timeout=20) as r:return r.status,dict(r.headers.items()),r.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers.items()),e.read()
status,headers,body=request('/')
assert status==200 and b'<html' in body.lower()
headers={k.lower():v for k,v in headers.items()}
for key in ['strict-transport-security','content-security-policy','x-content-type-options','referrer-policy','x-frame-options']:
    assert headers.get(key),key
assert headers['x-frame-options']=='DENY'
results={'site':SITE,'checked_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'https':status,'headers':{k:headers[k] for k in ['strict-transport-security','content-security-policy','x-content-type-options','referrer-policy','x-frame-options']}}
for path,expected in [('/health',200),('/ready',403),('/api/me',401),('/api/course',401),('/api/admin/users',401),('/api/openapi.json',401)]:
    actual,_,_=request(path);assert actual==expected,(path,actual,expected)
    results[path]=actual
status,_,_=request('/api/auth/sign-up/email',b'{}',{'Origin':SITE,'Content-Type':'application/json'})
assert status==403;results['public_signup']=status
status,_,_=request('/api/auth/sign-in/email',b'{}',{'Origin':'https://attacker.example','Content-Type':'application/json'})
assert status==403;results['cross_origin_write']=status
for path in ['/.env','/.git/config']:
    status,_,data=request(path)
    assert b'BETTER_AUTH_SECRET=' not in data and b'DATABASE_URL=' not in data and b'[core]' not in data
    results[path]='no configuration disclosed'
started=time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
    statuses=list(pool.map(lambda _:request('/health')[0],range(10)))
assert statuses==[200]*10
results['ten_parallel_health_requests']={'statuses':statuses,'seconds':round(time.monotonic()-started,3)}
attempts=[]
for index in range(6):
    status,_,_=request('/api/auth/sign-in/email',json.dumps({'email':'deployment-no-account@example.test','password':'Not-an-account-password-2026!'}).encode(),{'Origin':SITE,'Content-Type':'application/json','X-Forwarded-For':f'198.51.100.{index+1}','X-Real-IP':f'192.0.2.{index+1}'})
    attempts.append(status)
assert attempts[-1]==429 and set(attempts)<=set([401,429]),attempts
results['spoofed_ip_login_attempts']=attempts
print(json.dumps(results,ensure_ascii=False,indent=2))
