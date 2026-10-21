import contextlib,importlib.util,io,json,re,unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('verify_public',Path(__file__).with_name('verify-public.py'))
verify=importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
ALLOWED="default-src 'self'; media-src 'self' blob: https://a1.marugotoweb.jp; object-src 'none'"
BLOCKED="default-src 'self'; media-src 'self' blob:; object-src 'none'"

class VideoPolicyTests(unittest.TestCase):
    def test_reviewed_nginx_template_meets_the_same_public_contract(self):
        template=Path(__file__).with_name('nginx-http.conf').read_text()
        policy=re.search(r'add_header Content-Security-Policy "([^"]+)" always;',template)
        self.assertIsNotNone(policy)
        verify.assert_video_media_policy([policy.group(1)])

    def test_reviewed_exact_media_sources_pass(self):
        verify.assert_video_media_policy([ALLOWED])
        verify.assert_video_media_policy([ALLOWED,ALLOWED])
        verify.assert_video_media_policy(["MEDIA-SRC https://a1.marugotoweb.jp blob: 'self'"])

    def test_missing_or_broad_or_lookalike_media_sources_fail(self):
        for policy in [BLOCKED,"default-src 'self' https://a1.marugotoweb.jp",ALLOWED.replace('https://a1.marugotoweb.jp','https://a1.marugotoweb.jp.attacker.test'),ALLOWED.replace('https://a1.marugotoweb.jp','https:'),ALLOWED.replace('https://a1.marugotoweb.jp','*'),ALLOWED.replace('https://a1.marugotoweb.jp','https://*.marugotoweb.jp'),ALLOWED.replace("media-src ","media-src https: ")]:
            with self.subTest(policy=policy),self.assertRaises(AssertionError):verify.assert_video_media_policy([policy])
        for headers in [None,[],['']]:
            with self.subTest(headers=headers),self.assertRaises(AssertionError):verify.assert_video_media_policy(headers)

    def test_every_enforced_policy_must_allow_the_stream(self):
        for headers in [[ALLOWED,BLOCKED],[ALLOWED+', '+BLOCKED],[BLOCKED+', '+ALLOWED]]:
            with self.subTest(headers=headers),self.assertRaises(AssertionError):verify.assert_video_media_policy(headers)

    def test_first_duplicate_directive_matches_browser_semantics(self):
        verify.assert_video_media_policy([ALLOWED+"; media-src 'none'"])
        with self.assertRaises(AssertionError):verify.assert_video_media_policy([BLOCKED+"; media-src 'self' blob: https://a1.marugotoweb.jp"])

    def test_headers_only_makes_exactly_one_head_and_preserves_all_policies(self):
        headers=Message()
        for name,value in [('Strict-Transport-Security','max-age=31536000'),('Content-Security-Policy',ALLOWED),('X-Content-Type-Options','nosniff'),('Referrer-Policy','no-referrer'),('X-Frame-Options','DENY')]:headers.add_header(name,value)
        with patch.object(verify,'request',return_value=(200,headers,b'')) as request,contextlib.redirect_stdout(io.StringIO()) as output:
            verify.main(['https://example.test','--headers-only'])
        request.assert_called_once_with('https://example.test','/',method='HEAD')
        self.assertEqual(json.loads(output.getvalue())['mode'],'headers-only')
        headers.add_header('Content-Security-Policy',BLOCKED)
        with patch.object(verify,'request',return_value=(200,headers,b'')) as request,self.assertRaises(AssertionError):verify.main(['https://example.test','--headers-only'])
        request.assert_called_once_with('https://example.test','/',method='HEAD')

    def test_full_verifier_checks_policy_before_any_authentication_requests(self):
        headers=Message();headers.add_header('Content-Security-Policy',BLOCKED)
        with patch.object(verify,'request',return_value=(200,headers,b'<html>')) as request,self.assertRaises(AssertionError):verify.main(['https://example.test'])
        request.assert_called_once_with('https://example.test','/',method='GET')

if __name__=='__main__':unittest.main()
