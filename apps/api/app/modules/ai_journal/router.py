from __future__ import annotations

from fastapi import APIRouter, Query
from typing import Optional
from .models import ConfirmRequest, DeleteNoteRequest, NoteRequest, PreviewRequest, QuantLinkRequest, AgentCapabilityTestRequest
from .service import JournalService
from .store import JournalStore
from .capabilities import capabilities
from app.modules.market_board.router import _service as board_service
from .calendar import calendar as read_calendar, note
from .quant_links import link_run
from .context import available_positions
from .agent.contracts import RunResponse
from app.modules.trading_data import load_trading_state
import json

router = APIRouter(prefix='/api/ai-journal', tags=['ai-journal'])
_store = JournalStore()
_service = JournalService(_store, board_service)


@router.get('/agent-capabilities')
def agent_capabilities():
    from .agent.capabilities import protocol_matrix
    from .agent.store import AgentStore
    from .agent.model import ready, runtime_available, adapter_version_for, DEEPSEEK_ADAPTER_VERSION
    from .service import model_fingerprint
    settings = _service.settings()
    capability = AgentStore(_store).capability(model_fingerprint(settings))
    enabled = ready(settings, capability)
    matrix = protocol_matrix()
    for row in matrix:
        if enabled and (row['protocol'] == capability.endpoint or
                        (row['protocol'] == 'deepseek' and adapter_version_for(settings) == DEEPSEEK_ADAPTER_VERSION)):
            row.update(enabled=True, reason='verified_current_configuration')
    return {'enabled':enabled, 'automatic_probe':False, 'runtime_available':runtime_available(),
            'endpoint':capability.endpoint, 'verification':capability.verification,
            'adapter_version':capability.adapter_version, 'protocols':matrix}


@router.post('/agent-capabilities/test')
def test_agent_capability(payload: AgentCapabilityTestRequest):
    import asyncio
    from .agent.store import AgentStore
    from .agent.model import probe, runtime_available, execution_enabled, endpoint_for
    from .service import model_fingerprint
    from .store import fail
    from app.modules.privacy_policy import ensure_ai_inference_allowed
    if not runtime_available():
        fail('agent_runtime_unavailable', 422)
    if not execution_enabled():
        fail('agent_execution_not_ready', 422)
    settings = _service.settings()
    fingerprint = model_fingerprint(settings)
    try:
        endpoint_for(settings, payload.endpoint)
    except ValueError:
        fail('agent_model_unsupported', 422)

    def check_access():
        ensure_ai_inference_allowed()
        if model_fingerprint(_service.settings()) != fingerprint:
            fail('preview_changed')

    check_access()
    try:
        capability = asyncio.run(probe(settings, payload.endpoint, check_access))
    except Exception:
        fail('agent_probe_failed_or_outcome_unknown', 502)
    check_access()
    AgentStore(_store).save_capability(capability.model_dump())
    return {'enabled':True, 'endpoint':capability.endpoint, 'verification':capability.verification,
            'verified_at':capability.verified_at, 'automatic_probe':False}


@router.get('/runs/{run_id}', response_model=RunResponse)
def agent_run(run_id: str):
    from .agent.store import AgentStore
    return AgentStore(_store).get(run_id)


@router.post('/runs/{run_id}/cancel', response_model=RunResponse)
def cancel_agent_run(run_id: str):
    from .agent.store import AgentStore
    return AgentStore(_store).cancel(run_id)


@router.get('/runs/{run_id}/sources')
def agent_sources(run_id: str):
    from .agent.store import AgentStore
    return {'items': AgentStore(_store).sources(run_id)}


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


@router.get('/snapshots/{snapshot_id}/session')
def snapshot_session(snapshot_id: str):
    return _store.session_for_snapshot(snapshot_id)


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


@router.get('/notes/{note_id}/versions')
def note_versions(note_id: str):
    return _store.note_versions(note_id)


@router.post('/notes')
def create_note(payload: NoteRequest):
    return _store.save_note(payload.body, journal_date=payload.journal_date)


@router.put('/notes/{note_id}')
def update_note(note_id: str, payload: NoteRequest):
    return _store.save_note(payload.body, note_id, payload.journal_date)


@router.delete('/notes/{note_id}')
def delete_note(note_id: str, payload: DeleteNoteRequest):
    return _store.delete_note(note_id)


@router.post('/quant-links')
def quant_link(payload: QuantLinkRequest):
    return link_run(_store, board_service, payload.session_id, payload.run_id)
