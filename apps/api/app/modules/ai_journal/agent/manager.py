from __future__ import annotations

import asyncio
import threading
import time
from app.modules.ai_settings import IncompleteCompletionError, load_ai_settings
from ..service import model_fingerprint
from ..store import JournalStore, digest
from .store import AgentStore
from .model import ready, runtime_available, build_agent_model, output_limit_for
from .runtime import AccessRevoked, ModelOutcomeUnknown, Budget, ToolExecutor
from .contracts import EvidenceBook, Report
from .adapters import private_access, frozen_ports
from .tools import make_tools
from .prompts import add_scope_filter_status, initial_messages, render
from .research import default_research


class JournalAgentManager:
    def __init__(self, journal=None, settings=load_ai_settings, model_factory=build_agent_model,
                 access=private_access, enabled=runtime_available, research_factory=default_research):
        self.journal = journal or JournalStore()
        self.store = AgentStore(self.journal)
        self.settings, self.model_factory, self.access, self.enabled = settings, model_factory, access, enabled
        self.research_factory = research_factory
        self._stop = threading.Event()
        self._thread = None
        self._lock = threading.Lock()
        self._owned = None

    def start(self):
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self.store.recover_expired()
            if not self.enabled():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._worker, name='ai-journal-agent-worker', daemon=True)
            self._thread.start()

    def stop(self):
        with self._lock:
            self._stop.set()
            thread = self._thread
            if self._owned:
                self.store.terminate(*self._owned, 'outcome_unknown', 'shutdown_outcome_unknown')
        if thread:
            thread.join(timeout=3)
        with self._lock:
            if not thread or not thread.is_alive():
                self._thread = None

    def _worker(self):
        while not self._stop.is_set():
            try:
                self.store.recover_expired()
                for run_id in self.store.queued():
                    if self._stop.is_set():
                        return
                    self.execute(run_id)
            except Exception:
                # Never print provider errors, credentials, messages or original records.
                pass
            self._stop.wait(.5)

    def execute(self, run_id):
        if self._stop.is_set():
            return
        token = self.store.claim_queued(run_id, lease_seconds=180)
        if not token:
            return
        with self._lock:
            self._owned = (run_id, token)
            stopping = self._stop.is_set()
        budget = Budget()
        try:
            if stopping:
                raise AccessRevoked('manager_stopped')
            run = self.store.get(run_id)
            snapshot, checksum, fingerprint = self.journal.snapshot(run['snapshot_id'])
            if digest(snapshot) != checksum or fingerprint != run['model_fingerprint']:
                raise ValueError('snapshot_integrity_invalid')
            settings = self.settings()
            if snapshot['agent_scope'].get('public_research'):
                budget = Budget(deadline=time.monotonic() + 150, max_model_calls=7, max_tool_calls=14,
                                max_external_tools=8, max_input_bytes=56000, max_reserved_units=420000)
            budget.max_output_tokens = output_limit_for(settings)
            capability = self.store.capability(fingerprint)
            if model_fingerprint(settings) != fingerprint or not ready(settings, capability) or snapshot.get('agent_endpoint') != capability.endpoint:
                raise ValueError('agent_model_unverified')

            def check_access():
                if self._stop.is_set():
                    raise AccessRevoked('manager_stopped')
                self.store.assert_owned(run_id, token)
                if model_fingerprint(self.settings()) != fingerprint:
                    raise AccessRevoked('model_configuration_changed')
                self.access(snapshot, self.journal)

            check_access()
            book = EvidenceBook()
            ports = frozen_ports(snapshot, check_access)
            research = self.research_factory() if snapshot['agent_scope'].get('public_research') else None
            specs = make_tools(book=book, scope=snapshot['agent_scope'], research=research, **ports)
            executor = ToolExecutor(specs, book, budget, check_access)

            def progress():
                self.store.progress(run_id, token, budget.usage(), executor.events, list(book.rows.values()))

            executor.progress = progress
            from .graph import build_graph
            graph = build_graph(model_call=self.model_factory(settings, capability), executor=executor,
                                book=book, budget=budget, check_access=check_access, progress=progress,
                                research_plan=snapshot.get('research_plan'))
            state = asyncio.run(graph.ainvoke({'messages':initial_messages(snapshot), 'result':None,
                                              'repair_count':0, 'stop_code':''}, {'recursion_limit':32}))
            check_access()
            report = Report.model_validate(state['result'])
            if state['stop_code'] == 'budget_exhausted':
                # A local preflight limit is a terminal failed run. Do not
                # archive the deterministic insufficiency sentinel as a
                # successful model answer.
                self.store.terminate(run_id, token, 'failed', 'agent_run_limit', budget.usage())
            elif state['stop_code'] == 'validation_failed':
                self.store.terminate(run_id, token, 'failed', 'report_validation_failed', budget.usage())
            else:
                report = add_scope_filter_status(report, snapshot)
                self.store.finish(run_id, token, report, render(report), list(book.rows.values()), executor.events, budget.usage())
        except IncompleteCompletionError:
            self.store.terminate(run_id, token, 'failed', 'model_output_truncated', budget.usage())
        except ModelOutcomeUnknown:
            self.store.terminate(run_id, token, 'outcome_unknown', 'model_outcome_unknown', budget.usage())
        except AccessRevoked:
            self.store.terminate(run_id, token, 'cancelled', 'access_revoked_repreview', budget.usage())
        except Exception:
            # Conservative classification if execution stopped while a request was in flight.
            status = 'outcome_unknown' if budget.in_flight else 'failed'
            self.store.terminate(run_id, token, status, 'agent_run_failed' if status == 'failed' else 'model_outcome_unknown', budget.usage())
        finally:
            with self._lock:
                self._owned = None


journal_agent_manager = JournalAgentManager()
