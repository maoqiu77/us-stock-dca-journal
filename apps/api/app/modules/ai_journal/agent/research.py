"""Bounded public research. Search terms contain company metadata, never private records."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl
from xml.etree import ElementTree

from app.modules.market_board.http import PublicHttp
from app.modules.research_news import _company_search_terms, _news_relevance
from ..news import clean

TOPICS = {
    'company_news': 'stock news', 'earnings': 'earnings results revenue',
    'margins': 'gross margin profitability', 'guidance': 'outlook guidance',
    'orders': 'orders backlog demand', 'risks': 'risks investigation competition',
    'analyst_views': 'analyst rating target', 'official_results': 'earnings results investor relations',
}
DOCUMENT_HOSTS = frozenset({
    'finance.yahoo.com', 'www.nasdaq.com', 'www.reuters.com', 'www.cnbc.com',
    'www.businesswire.com', 'www.globenewswire.com', 'www.prnewswire.com',
    'www.sec.gov', 'data.sec.gov', 'stockanalysis.com', 'www.fool.com',
    'ir.supermicro.com', 'investor.nvidia.com', 'nvidianews.nvidia.com',
})


def canonical_url(url):
    parsed = urlparse(str(url or ''))
    query = [(key, value) for key, value in parse_qsl(parsed.query) if not key.lower().startswith('utm_') and key.lower() not in {'guccounter', 'guce_referrer', 'guce_referrer_sig'}]
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip('/'), '', urlencode(sorted(query)), ''))


def same_publication(left, right):
    if left.get('instrument_key') != right.get('instrument_key'):
        return False
    if left.get('url') and canonical_url(left['url']) == canonical_url(right.get('url')):
        return left.get('published_at') == right.get('published_at')
    normalize = lambda text: re.sub(r'\W+', '', str(text or '')).casefold()
    return bool(left.get('title') and normalize(left['title']) == normalize(right.get('title'))
                and normalize(left.get('publisher')) == normalize(right.get('publisher'))
                and left.get('published_at') == right.get('published_at'))


def validated_keywords(keywords, source, key):
    """Only public phrases already observed may leave the app as query refinements."""
    if not keywords:
        return []
    if not source or source.kind not in {'news', 'document'} or source.payload.get('instrument_key') != key:
        raise ValueError('public_query_basis_required')
    public_text = re.sub(r'\s+', ' ', ' '.join([str(source.payload.get('title', '')), *source.payload.get('excerpts', [])])).casefold()
    result = []
    for keyword in keywords:
        term = re.sub(r'\s+', ' ', keyword).strip()
        if (not 2 <= len(term) <= 60 or not re.fullmatch(r'[\w\s.,%&+\-]+', term)
                or not re.search(r'(?<![a-z0-9])' + re.escape(term.casefold()) + r'(?![a-z0-9])', public_text)):
            raise ValueError('query_term_not_in_public_evidence')
        if term.casefold() not in [value.casefold() for value in result]:
            result.append(term)
    return result


class ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.parts, self.body, self.json_scripts = [], [], [], []
        self.script = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag not in {'br', 'img', 'meta', 'link', 'input', 'hr', 'source', 'wbr', 'area', 'embed', 'param', 'col', 'base'}:
            self.stack.append(tag)
        if tag == 'script' and attrs.get('type', '').lower() == 'application/ld+json':
            self.script = []
        if tag in {'p', 'div', 'tr', 'h1', 'h2', 'h3', 'li', 'br'}:
            self.body.append('\n')
            self.parts.append('\n')
        if tag in {'td', 'th'}:
            self.body.append(' | ')
            self.parts.append(' | ')

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.json_scripts.append(''.join(self.script))
            self.script = None
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)
        if any(tag in self.stack for tag in ('script', 'style', 'nav', 'footer', 'header', 'noscript', 'form', 'aside')):
            return
        if 'body' in self.stack:
            self.body.append(data)
        if 'article' in self.stack or 'main' in self.stack:
            self.parts.append(data)


def extract_article(raw, focus, *, filing=False):
    parser = ArticleParser()
    parser.feed(raw.decode('utf-8', errors='replace'))
    candidates = []
    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get('articleBody'), str):
                candidates.append(value['articleBody'])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    for script in parser.json_scripts:
        try:
            visit(json.loads(script))
        except (ValueError, RecursionError):
            continue
    if not candidates:
        candidates.append(''.join(parser.parts))
        if filing:
            candidates.append(''.join(parser.body))
    body = max(candidates, key=len, default='')
    lines = list(dict.fromkeys(re.sub(r'\s+', ' ', line).strip() for line in body.splitlines() if line.strip()))
    # Split enormous paragraphs without inventing or paraphrasing article content.
    chunks = [piece[i:i+700] for line in lines for piece in re.split(r'(?<=[.!?。！？])\s+', line)
              for i in range(0, len(piece), 700)]
    if sum(map(len, chunks)) < 300:
        raise ValueError('article_body_unavailable')
    terms = TOPICS.get(focus, '').lower().split()
    ranked = sorted(range(len(chunks)), key=lambda i: (-sum(term in chunks[i].lower() for term in terms), i))
    chosen, length = set(), 0
    for index in ranked:
        # Keep the qualification immediately before/after a claim, not isolated matches.
        neighbors = [i for i in range(max(0, index-1), min(len(chunks), index+2)) if i not in chosen]
        added = sum(len(chunks[i]) for i in neighbors)
        if length + added > 2600:
            continue
        chosen.update(neighbors)
        length += added
        if length >= 2000:
            break
    return {'excerpts': [chunks[i] for i in sorted(chosen)], 'extracted_characters': sum(map(len, chunks)),
            'returned_characters': length, 'reading_scope': 'excerpts', 'focus': focus}


class PublicResearch:
    def __init__(self, board, document_http=None):
        self.board = board
        self.documents = document_http or PublicHttp(allowed_hosts=DOCUMENT_HOSTS)
        self.search_cache, self.yahoo_cache, self.document_cache = {}, {}, {}

    def search(self, key, topic, keywords=()):
        cache_key = (key, topic, tuple(sorted(term.casefold() for term in keywords)))
        if cache_key in self.search_cache:
            return self.search_cache[cache_key]
        item = self.board.catalog.resolve(key)
        if not item:
            return []
        now, deadline = datetime.now(timezone.utc), time.monotonic() + 10
        days = 120 if topic in {'earnings', 'official_results', 'guidance', 'margins', 'orders'} else 14
        rows = []
        company_terms = _company_search_terms({'quotes': [{'symbol': item.symbol, 'longname': item.name}]}, item.symbol)
        # Yahoo supplies readable publisher URLs; targeted RSS supplements its limited feed.
        try:
            if key not in self.yahoo_cache:
                self.yahoo_cache[key] = json.loads(self.board.http.get('https://query1.finance.yahoo.com/v1/finance/search?' + urlencode(
                    {'q': item.symbol, 'quotesCount': 1, 'newsCount': 20}), max_bytes=400_000, deadline=deadline))
            payload = self.yahoo_cache[key]
            company_terms.extend(_company_search_terms(payload, item.symbol))
            for row in payload.get('news', []):
                if not isinstance(row, dict):
                    continue
                if item.symbol not in (row.get('relatedTickers') or []):
                    continue
                try:
                    rows.append({'title': row.get('title'), 'url': row.get('link'), 'publisher': row.get('publisher'),
                        'published_at': datetime.fromtimestamp(row['providerPublishTime'], timezone.utc),
                        'relatedTickers': row.get('relatedTickers', [])})
                except (KeyError, TypeError, ValueError, OverflowError):
                    continue
        except Exception:
            pass
        if topic != 'company_news' or keywords or not rows:
            try:
                company = item.symbol + ' stock' if item.market.value == 'US' else item.name
                specifics = ' '.join('"' + term + '"' for term in keywords)
                query = f'{company} {TOPICS[topic]} {specifics} when:{days}d'
                raw = self.board.http.get('https://news.google.com/rss/search?' + urlencode(
                    {'q': query, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'}), max_bytes=400_000, deadline=deadline)
                for row in ElementTree.fromstring(raw).findall('./channel/item')[:15]:
                    try:
                        rows.append({'title': row.findtext('title'), 'url': row.findtext('link'),
                            'publisher': row.findtext('source'), 'published_at': parsedate_to_datetime(row.findtext('pubDate'))})
                    except (TypeError, ValueError, OverflowError):
                        continue
            except Exception:
                pass
        result, seen = [], set()
        for row in rows:
            title, url = clean(row['title'], 240), str(row['url'] or '')
            try:
                parsed, stamp = urlparse(url), row['published_at']
                if parsed.port not in (None, 443):
                    continue
            except ValueError:
                continue
            relevance, _ = _news_relevance(item.symbol, title, '', row.get('relatedTickers'), company_terms)
            identity = re.sub(r'\W+', '', title).casefold()
            if (not title or not row['publisher'] or not relevance or identity in seen or not stamp.tzinfo
                    or not now - timedelta(days=days) <= stamp <= now or parsed.scheme != 'https'
                    or not parsed.hostname or parsed.username or parsed.password):
                continue
            seen.add(identity)
            result.append({'instrument_key': key, 'title': title, 'url': url, 'publisher': clean(row['publisher'], 100),
                'published_at': stamp.isoformat(), 'fetched_at': now.isoformat(), 'reading_scope': 'headline_only',
                'topic': topic, 'relevance': relevance,
                'readable_host': parsed.hostname in DOCUMENT_HOSTS})
        terms = TOPICS[topic].split()
        result.sort(key=lambda r: (sum(term.casefold() in r['title'].casefold() for term in keywords),
            sum(term in r['title'].lower() for term in terms), r['relevance'], r['published_at']), reverse=True)
        self.search_cache[cache_key] = result[:5]
        return self.search_cache[cache_key]

    def read(self, payload, focus):
        url = payload['url']
        host = urlparse(url).hostname
        if host not in DOCUMENT_HOSTS:
            return {'status': 'unavailable', 'reason': '该来源暂不能直接读取正文，可换用另一来源；未读取全文。'}
        try:
            normalized = canonical_url(url)
            if normalized not in self.document_cache:
                self.document_cache[normalized] = self.documents.get(url, max_bytes=3_000_000)
            raw = self.document_cache[normalized]
            text = extract_article(raw, focus, filing=host == 'www.sec.gov')
        except Exception:
            return {'status': 'unavailable', 'reason': '正文未能读取（网站限制、跳转或格式不支持）；不能当作已核实全文。'}
        return {**payload, **text, 'status': 'available', 'fetched_at': datetime.now(timezone.utc).isoformat()}

    def filings(self, key):
        item = self.board.catalog.resolve(key)
        if not item or item.market.value != 'US':
            return []
        deadline = time.monotonic() + 10
        try:
            data = json.loads(self.documents.get('https://www.sec.gov/files/company_tickers_exchange.json', deadline=deadline))
            entries = [dict(zip(data['fields'], row)) for row in data['data']]
            company = next(row for row in entries if row['ticker'] == item.symbol)
            cik = int(company['cik'])
            data = json.loads(self.documents.get(f'https://data.sec.gov/submissions/CIK{cik:010d}.json', deadline=deadline))
            recent = data['filings']['recent']
            now, rows = datetime.now(timezone.utc), []
            for i, form in enumerate(recent['form']):
                if form not in {'10-K', '10-Q', '8-K', '20-F', '6-K'}:
                    continue
                acceptance = recent.get('acceptanceDateTime', [])[i]
                stamp = datetime.fromisoformat(acceptance.replace('Z', '+00:00'))
                if not stamp.tzinfo or not now - timedelta(days=400) <= stamp <= now:
                    continue
                accession = recent['accessionNumber'][i].replace('-', '')
                document = recent['primaryDocument'][i]
                if not re.fullmatch(r'\d+', accession) or not re.fullmatch(r'[\w.-]+', document):
                    continue
                rows.append({'instrument_key': key, 'title': f'{item.symbol} {form} · {recent["filingDate"][i]}',
                    'url': f'https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}',
                    'publisher': 'SEC EDGAR', 'published_at': stamp.isoformat(), 'fetched_at': now.isoformat(),
                    'reading_scope': 'filing_metadata_only', 'form': form})
                if len(rows) == 4:
                    break
            return rows
        except Exception:
            return []


def default_research():
    from app.modules.market_board.router import _service
    return PublicResearch(_service)
