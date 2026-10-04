"""Small, timestamped public news snapshots; no private query text leaves the app."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urlencode, urlparse
from xml.etree import ElementTree
from .agent.memory import ALIASES


def clean(value, limit):
    return unescape(re.sub(r'<[^>]+>', '', str(value or ''))).strip()[:limit]


def news_facts(board, key, now):
    item = board.catalog.resolve(key)
    if not item or not getattr(board, 'http', None):
        return [], [key + '：新闻源暂不可用']
    deadline = time.monotonic() + 7
    articles = []
    # Use symbol-specific metadata, never the user's question, positions or notes.
    if item.market.value == 'US':
        try:
            payload = json.loads(board.http.get(
                'https://query1.finance.yahoo.com/v1/finance/search?' + urlencode(
                    {'q': item.symbol, 'quotesCount': 0, 'newsCount': 12}),
                max_bytes=300_000, deadline=deadline))
            for row in payload.get('news', [])[:12]:
                try:
                    if item.symbol not in (row.get('relatedTickers') or []):
                        continue
                    articles.append((row.get('title'), '', row.get('link'), row.get('publisher'),
                        datetime.fromtimestamp(row['providerPublishTime'], timezone.utc), 'Yahoo Finance'))
                except (ValueError, TypeError, KeyError, OverflowError, AttributeError):
                    continue
        except Exception:
            pass
    if not articles:
        try:
            query = (item.symbol + ' stock' if item.market.value == 'US' else item.name) + ' when:7d'
            raw = board.http.get('https://news.google.com/rss/search?' + urlencode(
                {'q': query, 'hl': 'zh-CN', 'gl': 'CN', 'ceid': 'CN:zh-Hans'}),
                max_bytes=300_000, deadline=deadline)
            root = ElementTree.fromstring(raw)
            for row in root.findall('./channel/item')[:12]:
                try:
                    articles.append((row.findtext('title'), '', row.findtext('link'),
                        row.findtext('source'), parsedate_to_datetime(row.findtext('pubDate')), 'Google News'))
                except (ValueError, TypeError, OverflowError):
                    continue
        except Exception:
            pass
    facts, seen = [], set()
    for title, summary, url, publisher, published, source in articles:
        title = clean(title, 240)
        link = urlparse(str(url or ''))
        if (not title or not publisher or not published.tzinfo or
                not now - timedelta(days=7) <= published <= now or
                link.scheme != 'https' or not link.hostname or link.username or link.password or
                title in seen):
            continue
        seen.add(title)
        names = (item.name, *ALIASES.get(item.symbol, ()))
        direct = bool(re.search(r'(?<![A-Z0-9])' + re.escape(item.symbol) + r'(?![A-Z0-9])', title.upper())) or any(
            len(name) >= 2 and name.upper() in title.upper() for name in names)
        facts.append({'kind': '新闻', 'instrument_key': key, 'value': {
            'title': title, 'summary': clean(summary, 600), 'url': url,
            'publisher': clean(publisher, 100), 'published_at': published.isoformat(),
            'reading_scope': 'headline_only',
            'relevance': 'direct_mention' if direct else 'related_search_result',
            'meta': {'source': source, 'as_of': published.isoformat(),
                     'fetched_at': now.isoformat(), 'status': 'available', 'timeliness': 'delayed'},
        }})
    facts.sort(key=lambda row: (row['value']['relevance'] == 'direct_mention', row['value']['published_at']), reverse=True)
    return facts[:5], [] if facts else [item.symbol + '：暂未取得近7天可核实的新闻，不代表没有新闻']
