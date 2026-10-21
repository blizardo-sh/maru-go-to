#!/usr/bin/env python3
"""Public release checks; --headers-only makes one read-only HEAD request."""
import argparse,concurrent.futures,json,time,urllib.error,urllib.request
from urllib.parse import urlsplit

VIDEO_MEDIA_SOURCES={"'self'",'blob:','https://a1.marugotoweb.jp'}

def assert_video_media_policy(headers):
    """Every enforced policy must permit only the reviewed media sources."""
    assert headers, 'Missing Content-Security-Policy'
    for header in headers:
        for policy in header.split(','):
            directives=[part.split() for part in policy.split(';') if part.strip()]
            # Browsers use the first occurrence of a repeated directive.
            media=next((parts[1:] for parts in directives if parts[0].lower()=='media-src'),None)
            assert media is not None and set(media)==VIDEO_MEDIA_SOURCES, 'media-src must be exactly self, blob: and https://a1.marugotoweb.jp; update the active host policy separately'

def request(site,path,body=None,headers=None,method=None):
    req=urllib.request.Request(site+path,data=body,headers=headers or {},method=method)
    try:
        with urllib.request.urlopen(req,timeout=20) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin',help='HTTPS origin without credentials or a path')
    parser.add_argument('--headers-only',action='store_true',help='HEAD / only; no authentication requests')
    args=parser.parse_args(argv)
    site=args.origin.rstrip('/')
    origin=urlsplit(site)
    assert origin.scheme=='https' and origin.hostname and origin.username is None and origin.password is None and not origin.path and not origin.query and not origin.fragment, 'Use an HTTPS origin without credentials or a path'
    method='HEAD' if args.headers_only else 'GET'
    status,raw_headers,body=request(site,'/',method=method)
    assert status==200 and (args.headers_only or b'<html' in body.lower())
    assert_video_media_policy(raw_headers.get_all('Content-Security-Policy'))
    headers={k.lower():v for k,v in raw_headers.items()}
    required=['strict-transport-security','content-security-policy','x-content-type-options','referrer-policy','x-frame-options']
    for key in required:assert headers.get(key),key
    assert headers['x-frame-options']=='DENY'
    results={'site':site,'checked_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'mode':'headers-only' if args.headers_only else 'release','https':status,'headers':{k:headers[k] for k in required},'video_media_policy':'exact official host allowed'}
    if args.headers_only:
        print(json.dumps(results,ensure_ascii=False,indent=2));return
    for path,expected in [('/health',200),('/ready',403),('/api/me',401),('/api/course',401),('/api/admin/users',401),('/api/openapi.json',401)]:
        actual,_,_=request(site,path);assert actual==expected,(path,actual,expected)
        results[path]=actual
    status,_,_=request(site,'/api/auth/sign-up/email',b'{}',{'Origin':site,'Content-Type':'application/json'})
    assert status==403;results['public_signup']=status
    status,_,_=request(site,'/api/auth/sign-in/email',b'{}',{'Origin':'https://attacker.example','Content-Type':'application/json'})
    assert status==403;results['cross_origin_write']=status
    for path in ['/.env','/.git/config']:
        status,_,data=request(site,path)
        assert b'BETTER_AUTH_SECRET=' not in data and b'DATABASE_URL=' not in data and b'[core]' not in data
        results[path]='no configuration disclosed'
    started=time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        statuses=list(pool.map(lambda _:request(site,'/health')[0],range(10)))
    assert statuses==[200]*10
    results['ten_parallel_health_requests']={'statuses':statuses,'seconds':round(time.monotonic()-started,3)}
    attempts=[]
    for index in range(6):
        status,_,_=request(site,'/api/auth/sign-in/email',json.dumps({'email':'deployment-no-account@example.test','password':'Not-an-account-password-2026!'}).encode(),{'Origin':site,'Content-Type':'application/json','X-Forwarded-For':f'198.51.100.{index+1}','X-Real-IP':f'192.0.2.{index+1}'})
        attempts.append(status)
    assert attempts[-1]==429 and set(attempts)<=set([401,429]),attempts
    results['spoofed_ip_login_attempts']=attempts
    print(json.dumps(results,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
