from __future__ import annotations

import queue
import threading
from typing import Any

import requests
from fastapi import HTTPException

from app.api_models import QuantAnalysisRunRequest
from app.modules.ai_settings import load_ai_settings
from app.modules.privacy_policy import ensure_ai_inference_allowed
from app.modules.quant_analysis.calendar import normalize_us_trading_date
from app.modules.quant_analysis.engine import build_input_signature
from app.modules.quant_analysis.execution import execute_analysis_run
from app.modules.quant_analysis.reflection import generate_reflection
from app.modules.quant_analysis.sources import InstrumentResolutionError, resolve_instrument
from app.modules.quant_analysis.store import (
    create_analysis_run,
    delete_analysis_run,
    find_reusable_analysis_run,
    get_analysis_run,
    list_analysis_runs,
    mark_active_runs_interrupted,
    update_analysis_run,
)


class QuantAnalysisManager:
    def __init__(self) -> None:
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._delete_lock = threading.Lock()
        self._deleted_run_ids: set[str] = set()

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            mark_active_runs_interrupted()
            self._thread = threading.Thread(
                target=self._worker,
                name="quant-analysis-worker",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        with self._lock:
            thread = self._thread
            if not thread:
                return
            self._queue.put(None)
            thread.join(timeout=3)
            self._thread = None

    def submit(self, request: QuantAnalysisRunRequest) -> dict[str, Any]:
        ensure_ai_inference_allowed()
        settings = load_ai_settings()
        simple_model = str(settings.get("simpleModel") or settings.get("model") or "").strip()
        complex_model = str(settings.get("complexModel") or settings.get("model") or "").strip()
        if not (
            str(settings.get("baseUrl") or "").strip()
            and simple_model
            and complex_model
            and str(settings.get("apiKey") or "").strip()
        ):
            raise HTTPException(status_code=400, detail="请先在数据管理中配置完整的 AI 接口。")
        try:
            instrument = resolve_instrument(request.ticker)
        except InstrumentResolutionError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"标的身份解析失败：{exc}") from exc

        effective_date = normalize_us_trading_date(request.analysisDate)
        analysts = [analyst.value for analyst in request.analysts]
        signature = build_input_signature(
            ticker=instrument["ticker"],
            effective_date=effective_date,
            mode=request.mode.value,
            analysts=analysts,
            simple_model=simple_model,
            complex_model=complex_model,
        )
        if not request.forceRegenerate:
            reusable = find_reusable_analysis_run(signature)
            if reusable:
                return {
                    **reusable,
                    "reused": True,
                    "dateAdjusted": request.analysisDate != effective_date,
                    "instrument": instrument,
                }
        run = create_analysis_run(
            ticker=instrument["ticker"],
            requested_date=request.analysisDate,
            effective_date=effective_date,
            mode=request.mode.value,
            analysts=analysts,
            reflection_enabled=request.reflectionEnabled,
            input_signature=signature,
            simple_model=simple_model,
            complex_model=complex_model,
        )
        run = update_analysis_run(run["id"], asset_type=instrument["assetType"])
        self._queue.put(run["id"])
        return {
            **run,
            "reused": False,
            "dateAdjusted": request.analysisDate != effective_date,
            "instrument": instrument,
        }

    def get(self, run_id: str) -> dict[str, Any]:
        try:
            return get_analysis_run(run_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="量化分析任务不存在。") from exc

    def list(
        self,
        *,
        ticker: str | None = None,
        effective_date: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        return list_analysis_runs(
            ticker=ticker.strip().upper() if ticker else None,
            effective_date=effective_date,
            status=status,
        )

    def delete(self, run_id: str) -> dict[str, Any]:
        run = self.get(run_id)
        if run["status"] in {"queued", "running", "cancel_requested"}:
            with self._delete_lock:
                self._deleted_run_ids.add(run_id)
        try:
            return delete_analysis_run(run_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="量化分析任务不存在。") from exc

    def cancel(self, run_id: str) -> dict[str, Any]:
        run = self.get(run_id)
        if run["status"] in {"completed", "failed", "canceled"}:
            raise HTTPException(status_code=409, detail="该任务已经结束。")
        return update_analysis_run(run_id, status="cancel_requested")

    def resume(self, run_id: str) -> dict[str, Any]:
        ensure_ai_inference_allowed()
        run = self.get(run_id)
        if run["status"] != "interrupted":
            raise HTTPException(status_code=409, detail="只有已中断任务可以继续。")
        resumed = update_analysis_run(
            run_id,
            status="queued",
            error_code="",
            error_message="",
        )
        self._queue.put(run_id)
        return resumed

    def reflect(self, run_id: str) -> dict[str, Any]:
        return generate_reflection(run_id)

    def _worker(self) -> None:
        while True:
            run_id = self._queue.get()
            try:
                if run_id is None:
                    return
                execute_analysis_run(run_id)
            except Exception as exc:
                if run_id:
                    try:
                        update_analysis_run(
                            run_id,
                            status="interrupted",
                            error_code="worker_error",
                            error_message=f"后台任务异常：{exc}",
                        )
                    except Exception:
                        pass
            finally:
                if run_id:
                    with self._delete_lock:
                        deleted = run_id in self._deleted_run_ids
                    if deleted:
                        try:
                            delete_analysis_run(run_id)
                        except KeyError:
                            pass
                        finally:
                            with self._delete_lock:
                                self._deleted_run_ids.discard(run_id)
                self._queue.task_done()


quant_analysis_manager = QuantAnalysisManager()
