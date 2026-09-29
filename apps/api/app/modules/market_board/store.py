from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable

from .migration import migrate_board_db
from .models import AssetType, Instrument, Segment, Selection


class SelectionConflict(Exception):
    pass


_SEGMENT_TYPES = {
    Segment.US: {AssetType.STOCK, AssetType.ETF},
    Segment.ETF: {AssetType.ETF},
    Segment.FUND: {AssetType.FUND},
}


class BoardStore:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        migrate_board_db(connection)
        return connection

    def ensure_initialized(self, defaults: dict[Segment, list[Instrument]]) -> None:
        with self._connect() as db:
            for segment in Segment:
                row = db.execute("select initialized from board_selections where segment = ?", (segment.value,)).fetchone()
                if row is not None and row[0]:
                    continue
                items = defaults.get(segment, [])
                for item in items:
                    db.execute("insert or ignore into board_instruments(key,payload) values (?,?)", (item.key, item.model_dump_json()))
                db.execute("insert or replace into board_selections(segment, revision, initialized) values (?,?,1)", (segment.value, 0))
                for order, item in enumerate(items):
                    db.execute("insert or replace into board_selection_items(segment,instrument_key,sort_order) values (?,?,?)", (segment.value, item.key, order))

    def save_instruments(self, items: Iterable[Instrument]) -> None:
        with self._connect() as db:
            for item in items:
                db.execute("insert or replace into board_instruments(key,payload) values (?,?)", (item.key, item.model_dump_json()))

    def get_instrument(self, key: str) -> Instrument | None:
        with self._connect() as db:
            row = db.execute("select payload from board_instruments where key=?", (key,)).fetchone()
        return Instrument.model_validate_json(row[0]) if row else None

    def get_selection(self, segment: Segment) -> Selection:
        with self._connect() as db:
            row = db.execute("select revision from board_selections where segment=?", (segment.value,)).fetchone()
            revision = int(row[0]) if row else 0
            keys = [r[0] for r in db.execute("select instrument_key from board_selection_items where segment=? order by sort_order", (segment.value,)).fetchall()]
            payloads = {r[0]: r[1] for r in db.execute("select key,payload from board_instruments where key in (%s)" % ",".join("?" * len(keys)), keys).fetchall()} if keys else {}
        return Selection(segment=segment, revision=revision, items=[Instrument.model_validate_json(payloads[k]) for k in keys if k in payloads])

    def replace_selection(self, segment: Segment, keys: list[str], expected_revision: int) -> Selection:
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate selection")
        if len(keys) > (100 if segment is Segment.US else 30):
            raise ValueError("selection too large")
        with self._connect() as db:
            row = db.execute("select revision from board_selections where segment=?", (segment.value,)).fetchone()
            revision = int(row[0]) if row else 0
            if revision != expected_revision:
                raise SelectionConflict("selection revision conflict")
            instruments = []
            for key in keys:
                raw = db.execute("select payload from board_instruments where key=?", (key,)).fetchone()
                if raw is None:
                    raise ValueError("unknown instrument")
                item = Instrument.model_validate_json(raw[0])
                if item.asset_type not in _SEGMENT_TYPES[segment]:
                    raise ValueError("instrument does not belong to segment")
                instruments.append(item)
            new_revision = revision + 1
            db.execute("insert or replace into board_selections(segment,revision,initialized) values(?,?,1)", (segment.value, new_revision))
            db.execute("delete from board_selection_items where segment=?", (segment.value,))
            db.executemany("insert into board_selection_items(segment,instrument_key,sort_order) values (?,?,?)", [(segment.value, key, i) for i, key in enumerate(keys)])
        return Selection(segment=segment, revision=new_revision, items=instruments)

    def read_cache(self, key: str) -> dict | None:
        with self._connect() as db:
            row = db.execute("select payload,expires_at,retain_until from board_cache where cache_key=?", (key,)).fetchone()
        if not row:
            return None
        payload = json.loads(row[0])
        payload["expires_at"], payload["retain_until"] = row[1], row[2]
        return payload

    def write_cache(self, key: str, payload: dict, expires_at: str, retain_until: str) -> None:
        with self._connect() as db:
            db.execute("insert or replace into board_cache(cache_key,payload,expires_at,retain_until) values (?,?,?,?)", (key, json.dumps(payload, ensure_ascii=False), expires_at, retain_until))

    def upsert_premium(self, key: str, basis: str, trade_date: str, premium: str, is_final: bool) -> None:
        with self._connect() as db:
            db.execute("insert or replace into board_premiums values (?,?,?,?,?)", (key, basis, trade_date, premium, int(is_final)))

    def read_premiums(self, key: str, basis: str, since: str) -> list[dict]:
        with self._connect() as db:
            rows = db.execute("select instrument_key,basis,trade_date,premium,is_final from board_premiums where instrument_key=? and basis=? and trade_date>=? order by trade_date", (key, basis, since)).fetchall()
        return [dict(row) for row in rows]

