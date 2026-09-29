from __future__ import annotations

from urllib.parse import urlparse
import requests


ALLOWED_HOSTS = {"query1.finance.yahoo.com", "query2.finance.yahoo.com", "api.nasdaq.com", "push2delay.eastmoney.com", "fund.eastmoney.com", "api.fund.eastmoney.com", "fundf10.eastmoney.com", "qt.gtimg.cn", "gu.qq.com"}


class PublicHttp:
    def __init__(self, requester=None, now=None):
        self.requester = requester or requests.get
        self.now = now

    def get(self, url: str, *, referer: str | None = None, max_bytes: int = 4_000_000, deadline: float | None = None) -> bytes:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            raise ValueError("source is not allow-listed")
        response = self.requester(url, headers={"User-Agent": "StockPlatform/1.0", **({"Referer": referer} if referer else {})}, timeout=deadline or 4, allow_redirects=False, stream=True)
        if response.status_code >= 300:
            raise RuntimeError(f"public source status {response.status_code}")
        chunks, size = [], 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > max_bytes:
                raise RuntimeError("public response too large")
            chunks.append(chunk)
        return b"".join(chunks)

