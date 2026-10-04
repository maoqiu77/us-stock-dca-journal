from __future__ import annotations
from urllib.parse import urlparse
from threading import BoundedSemaphore, Lock
from collections import defaultdict
from contextvars import ContextVar
from email.utils import parsedate_to_datetime
import time
import requests

ALLOWED_HOSTS = {"query1.finance.yahoo.com", "query2.finance.yahoo.com", "api.nasdaq.com", "push2delay.eastmoney.com", "fund.eastmoney.com", "api.fund.eastmoney.com", "fundf10.eastmoney.com", "qt.gtimg.cn", "gu.qq.com", "searchapi.eastmoney.com"}
REQUEST_DEADLINE = ContextVar('board_deadline', default=None)
ALLOWED_HOSTS.update({'www.szse.cn', 'query.sse.com.cn'})
ALLOWED_HOSTS.add('news.google.com')

class PublicHttp:
    def __init__(self, requester=None, now=None, *, allowed_hosts=None):
        self.requester = requester or requests.get
        self.allowed_hosts = frozenset(ALLOWED_HOSTS if allowed_hosts is None else allowed_hosts)
        self.clock = now or time.monotonic
        self.backoff = {}
        self.hosts = defaultdict(lambda: BoundedSemaphore(3))
        self.guard = Lock()

    def get(self, url, *, referer=None, max_bytes=4_000_000, deadline=None):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname not in self.allowed_hosts or parsed.username or parsed.password or parsed.port not in (None,443):
            raise ValueError('source is not allow-listed')
        end = min(deadline or float('inf'), REQUEST_DEADLINE.get() or float('inf'), self.clock()+4)
        host = parsed.hostname
        with self.guard:
            if self.backoff.get(host, 0) > self.clock():
                raise RuntimeError('public source cooling down')
        semaphore = self.hosts[host]
        if not semaphore.acquire(timeout=max(0, end-self.clock())):
            raise TimeoutError('source concurrency deadline')
        response = None
        try:
            remaining = end-self.clock()
            if remaining <= 0:
                raise TimeoutError('source deadline')
            response = self.requester(url, headers={'User-Agent':'Mozilla/5.0', **({'Referer':referer} if referer else {})}, timeout=(min(2,remaining),min(4,remaining)), allow_redirects=False, stream=True)
            if response.status_code == 429:
                raw = response.headers.get('Retry-After','60')
                try:
                    seconds = float(raw)
                except (ValueError,TypeError):
                    try: seconds = parsedate_to_datetime(raw).timestamp()-time.time()
                    except Exception: seconds = 60
                with self.guard:
                    self.backoff[host] = self.clock()+min(300,max(1,seconds))
            if response.status_code >= 300:
                raise RuntimeError('public source status '+str(response.status_code))
            if int(response.headers.get('Content-Length','0')) > max_bytes:
                raise RuntimeError('public response too large')
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                if self.clock() > end:
                    raise TimeoutError('source deadline')
                size += len(chunk)
                if size > max_bytes:
                    raise RuntimeError('public response too large')
                chunks.append(chunk)
            return b''.join(chunks)
        finally:
            if response is not None:
                response.close()
            semaphore.release()
