from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo
from .store import fail


def beijing_date(stamp):
    return datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(ZoneInfo('Asia/Shanghai')).date().isoformat()


def calendar(store, target_date=None):
    entries = []
    with store.connect() as db:
        for row in db.execute('select t.id,t.session_id,t.status,t.created_at,s.title,s.task_type,p.payload from ai_journal_turns t join ai_journal_sessions s on s.id=t.session_id left join ai_journal_snapshots p on p.id=t.snapshot_id order by t.created_at desc'):
            question = ''
            try:
                question = json.loads(row['payload']).get('request', {}).get('question', '')
            except (ValueError, TypeError, AttributeError):
                pass
            label = {'portfolio_review': '持仓分析', 'instrument_research': '标的快研', 'conversation': 'AI 对话'}.get(row['task_type'], 'AI 对话')
            title = f'{label} · {question[:80]}' if question else row['title']
            entries.append({'id': row['id'], 'kind': 'session', 'session_id': row['session_id'], 'title': title, 'status': row['status'], 'question': question, 'date': beijing_date(row['created_at'])})
        for row in db.execute('select * from ai_journal_notes where deleted_at is null order by created_at desc'):
            entries.append({'id': row['id'], 'kind': 'note', 'title': row['body'][:80], 'date': beijing_date(row['created_at'])})
        for row in db.execute('select l.*,r.status,r.ticker from ai_journal_quant_links l left join quant_analysis_runs r on r.id=l.run_id order by l.created_at desc'):
            entries.append({'id': row['run_id'], 'kind': 'quant', 'session_id': row['session_id'], 'title': '原报告已删除' if row['status'] is None else row['ticker'] + ' · 量化报告', 'status': row['status'], 'deleted': row['status'] is None, 'question': row['question'], 'date': beijing_date(row['created_at'])})
        legacy = db.execute("select payload from app_state where key='ai_advice_v1'").fetchone()
        if legacy:
            try:
                records = json.loads(legacy['payload']).get('records', {})
                entries.extend({'id': day, 'kind': 'legacy', 'title': '旧版 AI 分析', 'date': day} for day in records)
            except (ValueError, AttributeError, TypeError):
                pass
    dates = sorted({entry['date'] for entry in entries}, reverse=True)
    return {'dates': dates, 'items': [entry for entry in entries if not target_date or entry['date'] == target_date]}


def note(store, note_id):
    with store.connect() as db:
        row = db.execute('select * from ai_journal_notes where id=? and deleted_at is null', (note_id,)).fetchone()
    if not row:
        fail('note_not_found', 404)
    return dict(row)
