from __future__ import annotations

import re
from app.modules.trading_data import load_trading_state, derive_positions
from app.modules.privacy_policy import ensure_ai_inference_allowed
from .context import available_positions, private_context
from .store import fail, digest
from .agent.memory import ALIASES, candidates


def automatic_context(journal, board, request, stamp):
    state = load_trading_state()
    ensure_ai_inference_allowed(state)
    positions, excluded = available_positions(board, state)
    selected = positions[:30]
    effective = request.model_copy(update={'position_tickers': [row['ticker'] for row in selected],
        'plan_tickers': [row['ticker'] for row in selected], 'note_ids': [], 'trade_ids': [], 'history_turn_ids': []})
    private, missing = private_context(journal, board, effective, state=state)
    private['workspace_position_signature'] = position_signature(state)
    last = None
    if request.session_id:
        session = journal.session(request.session_id)
        last = next((turn for turn in reversed(session['turns']) if turn['status'] == 'completed'), None)
    memory_request = request.model_copy(update={'question': request.question + ' ' + last['snapshot']['request']['question']}) if last else request
    private.update(candidates(journal, state, memory_request, stamp))
    missing.extend('排除 ' + row['ticker'] + '：' + row['reason'] for row in excluded)
    if len(positions) > 30:
        missing.append('本轮仅覆盖前30个可核实持仓，不代表完整账户。')
    if request.memory_before:
        missing.append('记忆截止时间仅过滤原文版本；当前持仓和行情不代表过去时点。无版本时间的交易理由不纳入历史记忆。')
    if last:
        private['history'] = [{'id': last['id'], 'question': last['snapshot']['request']['question'][:4000], 'answer': last['answer'][:8000]}]
    return private, missing


def position_signature(state):
    return digest({'currency': state.get('account', {}).get('baseCurrency'), 'positions': sorted(
        [{key: row.get(key) for key in ('ticker', 'shares', 'costBasis', 'assetType')} for row in derive_positions(state) if row['shares'] > 0],
        key=lambda row: row['ticker'])})


def conversation_targets(board, request):
    with board.store._connect() as db:
        keys = [row[0] for row in db.execute('select key from board_instruments')]
    matches = {}
    question = request.question.upper()
    for key in keys:
        item = board.catalog.resolve(key)
        if not item:
            continue
        aliases = (item.name.upper(), *ALIASES.get(item.symbol, ()))
        exact = re.search(r'(?<![A-Z0-9])' + re.escape(item.symbol) + r'(?![A-Z0-9])', question)
        if exact or any(len(alias) >= 2 and alias in question for alias in aliases):
            matches.setdefault(item.symbol, []).append(key)
    for symbol, values in matches.items():
        if len(values) != 1:
            if request.instrument_key in values:
                matches[symbol] = [request.instrument_key]
            else:
                fail('instrument_identity_ambiguous', 422)
    if len(matches) > 10:
        fail('conversation_targets_too_many', 422)
    return list(dict.fromkeys(([request.instrument_key] if request.instrument_key else []) + [values[0] for values in matches.values()]))
