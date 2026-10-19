"""Native GET evidence; original entity bytes, valid TLS, no defense bypass."""
import concurrent.futures, datetime, hashlib, json, pathlib, sys, time, urllib.request, urllib.error
ROOT = pathlib.Path('/Users/alex/agent-hub/concerts-ru-data-2/evidence/official-west')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None
opener = urllib.request.build_opener(NoRedirect)
def capture(url):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    key = hashlib.sha256((now + url).encode()).hexdigest()[:18]
    meta = dict(url=url, capturedAt=now, method='GET', requestHeaders={'User-Agent':UA,'Accept-Encoding':'identity'}, tlsVerification=True)
    try:
        try: response = opener.open(urllib.request.Request(url,headers=meta['requestHeaders']),timeout=30)
        except urllib.error.HTTPError as e: response = e
        body=response.read(); meta.update(status=response.status,headers=dict(response.headers),body=key+'.body',sha256=hashlib.sha256(body).hexdigest())
        (ROOT/meta['body']).write_bytes(body)
    except Exception as e: meta.update(error=str(e),status=None)
    (ROOT/(key+'.json')).write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(file=key+'.json',url=url,status=meta['status'],error=meta.get('error'),body=meta.get('body')),ensure_ascii=False),flush=True)
    return meta
if __name__=='__main__':
    groups=json.loads(sys.argv[1])
    def group(urls):
        for url in urls:
            capture(url); time.sleep(11 if 'ddt' in url else 2)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: list(pool.map(group,groups))
