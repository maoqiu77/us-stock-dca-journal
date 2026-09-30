from .capabilities import capabilities
from .store import fail, now_iso


def link_run(store, board, session_id, run_id, resolver=None):
    session = store.session(session_id)
    key = session['instrument_key']
    if not key or not capabilities(board, key, resolver)['quant_eligible']:
        fail('quant_not_supported', 422)
    instrument = board.catalog.resolve(key)
    completed = [turn for turn in session['turns'] if turn['status'] == 'completed']
    if not completed:
        fail('completed_session_required', 422)
    question = completed[-1]['snapshot']['request']['question']
    with store.connect() as db:
        run = db.execute('select ticker,status from quant_analysis_runs where id=?', (run_id,)).fetchone()
        if not run:
            fail('quant_run_not_found', 404)
        if run['ticker'] not in {instrument.symbol, instrument.symbol.replace('.', '-')}:
            fail('quant_instrument_mismatch', 422)
        existing = db.execute('select session_id from ai_journal_quant_links where run_id=?', (run_id,)).fetchone()
        if existing and existing['session_id'] != session_id:
            fail('quant_link_conflict')
        db.execute('insert or ignore into ai_journal_quant_links values (?,?,?,?)', (run_id, session_id, question, now_iso()))
    return {'run_id': run_id, 'session_id': session_id}
