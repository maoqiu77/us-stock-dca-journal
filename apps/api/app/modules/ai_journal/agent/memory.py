from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime, timezone

from ..store import encoded, fail

# Aliases add search terms only; catalog resolution still establishes identity.
ALIASES = {'NVDA': ('英伟达', '英偉達', 'NVIDIA'), 'TSLA': ('特斯拉', 'TESLA'),
           'AAPL': ('苹果', '蘋果', 'APPLE'), 'MSFT': ('微软', '微軟', 'MICROSOFT'),
           'GOOGL': ('谷歌', 'GOOGLE'), 'AMZN': ('亚马逊', 'AMAZON')}
STOP = {'的', '了', '我', '是', '和', '请', '这个', '现在', '目前', '一下'}


def tokens(text):
    value = str(text).upper()
    for symbol, aliases in ALIASES.items():
        if re.search(r'(?<![A-Z0-9])' + re.escape(symbol) + r'(?![A-Z0-9])', value) or any(alias in value for alias in aliases):
            value += ' ' + symbol + ' ' + ' '.join(aliases)
    terms = re.findall(r'[A-Z0-9]+(?:[.-][A-Z0-9]+)*', value)
    for run in re.findall(r'[\u4e00-\u9fff]+', value):
        terms.extend(run[i:i+2] for i in range(len(run)-1))
        terms.extend(char for char in run if char not in STOP)
    return [term for term in terms if term not in STOP]


def rank(query, rows, text=lambda row: row.get('body') or row.get('note') or ''):
    """BM25 over user originals, including Chinese bigrams and verified aliases."""
    documents = [Counter(tokens(text(row))) for row in rows]
    if not documents:
        return []
    lengths = [sum(doc.values()) for doc in documents]
    average = sum(lengths) / len(lengths) or 1
    terms = set(tokens(query))
    frequency = {term: sum(term in doc for doc in documents) for term in terms}
    result = []
    for row, doc, length in zip(rows, documents, lengths):
        score = 0
        for term in terms:
            count = doc[term]
            if count:
                inverse = math.log(1 + (len(rows) - frequency[term] + .5) / (frequency[term] + .5))
                score += inverse * count * 2.5 / (count + 1.5 * (.25 + .75 * length / average))
        if score > 0:
            result.append((score, row))
    return sorted(result, key=lambda item: (-item[0], str(item[1].get('id', ''))))


def timestamp(value):
    try:
        stamp = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return stamp if stamp.tzinfo else None
    except (ValueError, TypeError):
        return None


def candidates(journal, state, request, stamp):
    cutoff = min(request.memory_before or stamp, stamp)
    excluded = set(request.memory_excluded_ids)
    rows = []
    with journal.connect() as db:
        for row in db.execute('select id,body,updated_at from ai_journal_notes where deleted_at is null'):
            row = dict(row)
            updated = timestamp(row['updated_at'])
            if updated and updated <= cutoff and row['id'] not in excluded and row['body'].strip() not in {'欢迎使用', '你好', '欢迎来到股票交易平台'}:
                rows.append({**row, '_kind': 'note'})
    for row in state.get('trades', []):
        if not row.get('note', '').strip() or row['id'] in excluded:
            continue
        try:
            if datetime.fromisoformat(row['date']).date() > cutoff.astimezone(timezone.utc).date():
                continue
        except (ValueError, TypeError):
            continue
        # A trade date alone cannot prove when this version of its reason existed.
        if request.memory_before:
            updated = timestamp(row.get('updated_at'))
            if not updated or updated > cutoff:
                continue
        rows.append({**{key: row[key] for key in ('id', 'ticker', 'date', 'note')}, '_kind': 'trade_reason'})
    manual = set(request.note_ids + request.trade_ids)
    ranked = [row for row in rows if row['id'] in manual]
    if len(ranked) > 24 or sum(len(encoded(row).encode()) for row in ranked) > 40000:
        fail('agent_memory_scope_too_large', 422)
    query = request.question
    if request.instrument_key:
        query += ' ' + request.instrument_key.split(':')[2]
    if request.auto_context or request.memory_mode == 'suggest_related':
        ranked += [row for _, row in rank(query, rows, lambda row: (row.get('ticker', '') + ' ' + (row.get('body') or row.get('note') or ''))) if row['id'] not in manual]
    selected, used = [], 0
    for row in ranked:
        size = len(encoded(row).encode())
        if len(selected) >= 24:
            break
        if used + size <= 40000:
            selected.append(row)
            used += size
    return {kind: [{key: value for key, value in row.items() if key != '_kind'} for row in selected if row['_kind'] == source]
            for kind, source in (('notes', 'note'), ('trade_reasons', 'trade_reason'))}


def retrieve(query, rows, *, before=None, after=None):
    eligible = [row for row in rows if (before is None or row.as_of <= before) and (after is None or row.as_of >= after)]
    by_id = {row.id: row for row in eligible}
    ranked = rank(query, [{**row.payload, 'id': row.id} for row in eligible],
                  lambda row: row.get('ticker', '') + ' ' + (row.get('body') or row.get('note') or ''))
    result, used = [], 0
    for _, payload in ranked:
        row = by_id[payload['id']]
        size = len(encoded(memory_view(row, query)).encode()) + 300
        if len(result) >= 6:
            break
        if used + size <= 9000:
            result.append(row)
            used += size
    return result


def memory_view(row, query):
    payload = dict(row.payload)
    field = 'body' if 'body' in payload else 'note'
    original = str(payload.get(field) or '')
    start = 0
    if len(original.encode()) > 1000:
        matches = []
        for term in sorted(set(tokens(query)), key=lambda term: (-len(term), term)):
            match = re.search(re.escape(term), original, re.IGNORECASE)
            if match:
                matches.append(match.start())
        start = max(0, matches[0] - 100) if matches else 0
    text = original[start:].encode()[:1000].decode('utf-8', errors='ignore')
    payload[field] = text
    payload['excerpt'] = {'start': start, 'end': start + len(text), 'original_length': len(original)}
    payload.update(source_id=row.id, as_of=row.as_of.isoformat())
    payload['time_semantics'] = {
        'trade_date': payload.get('date') if row.kind == 'trade_reason' else None,
        'original_version_at': payload.get('updated_at') if row.kind == 'note' else None,
        'snapshot_available_at': row.available_at.isoformat(),
        'as_of_meaning': 'note_version_time' if row.kind == 'note' else 'snapshot_time_not_trade_or_reason_version',
    }
    return payload
