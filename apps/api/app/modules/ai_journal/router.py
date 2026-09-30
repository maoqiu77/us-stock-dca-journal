from __future__ import annotations

from fastapi import APIRouter, Query
from typing import Optional
from .models import ConfirmRequest, DeleteNoteRequest, NoteRequest, PreviewRequest, QuantLinkRequest
from .service import JournalService
from .store import JournalStore
from .capabilities import capabilities
from app.modules.market_board.router import _service as board_service
from .calendar import calendar as read_calendar, note
from .quant_links import link_run
from .context import available_positions
from app.modules.trading_data import load_trading_state
import json

router = APIRouter(prefix='/api/ai-journal', tags=['ai-journal'])
_store = JournalStore()
_service = JournalService(_store, board_service)


@router.get('/capabilities')
def get_capabilities(key: str):
    return capabilities(board_service, key)


@router.post('/preview')
def preview(payload: PreviewRequest):
    return _service.preview(payload)


@router.post('/sessions')
def confirm(payload: ConfirmRequest):
    return _service.confirm(payload)


@router.get('/sessions/{session_id}')
def session(session_id: str):
    return _store.session(session_id)


@router.post('/sessions/{session_id}/turns')
def turn(session_id: str, payload: ConfirmRequest):
    return _service.confirm(payload, session_id)


@router.get('/calendar')
def calendar(target_date: Optional[str] = Query(default=None, pattern=r'^\d{4}-\d{2}-\d{2}$')):
    return read_calendar(_store, target_date)


@router.get('/context-options')
def context_options():
    state = load_trading_state()
    positions, excluded = available_positions(board_service, state)
    with _store.connect() as db:
        notes = [{'id': row['id'], 'label': row['body'][:80], 'length': len(row['body'])} for row in db.execute('select id,body from ai_journal_notes where deleted_at is null order by created_at desc limit 200')]
        history = [{'id': row['id'], 'label': json.loads(row['payload'])['request']['question'][:100]} for row in db.execute("select t.id,s.payload from ai_journal_turns t join ai_journal_snapshots s on s.id=t.snapshot_id where t.status='completed' order by t.created_at desc limit 200")]
    return {'positions': positions, 'excluded': excluded, 'plans': [row for row in state.get('positions', []) if row['ticker'] in {p['ticker'] for p in positions}], 'trades': [{'id': row['id'], 'label': row['ticker'] + ' · ' + row['date'], 'length': len(row['note'])} for row in state.get('trades', []) if row.get('note')][-200:], 'notes': notes, 'history': history}


@router.get('/notes/{note_id}')
def get_note(note_id: str):
    return note(_store, note_id)


@router.post('/notes')
def create_note(payload: NoteRequest):
    return _store.save_note(payload.body)


@router.put('/notes/{note_id}')
def update_note(note_id: str, payload: NoteRequest):
    return _store.save_note(payload.body, note_id)


@router.delete('/notes/{note_id}')
def delete_note(note_id: str, payload: DeleteNoteRequest):
    return _store.delete_note(note_id)


@router.post('/quant-links')
def quant_link(payload: QuantLinkRequest):
    return link_run(_store, board_service, payload.session_id, payload.run_id)
