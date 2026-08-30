from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class QuantAnalysisApiTest(unittest.TestCase):
    def test_quant_routes_are_exposed(self) -> None:
        paths = app.openapi()["paths"]

        for path in (
            "/api/quant-analysis/runs",
            "/api/quant-analysis/runs/{run_id}",
            "/api/quant-analysis/runs/{run_id}/cancel",
            "/api/quant-analysis/runs/{run_id}/resume",
            "/api/quant-analysis/runs/{run_id}/reflection",
            "/api/research-settings",
            "/api/research-settings/fred/test",
        ):
            with self.subTest(path=path):
                self.assertIn(path, paths)

    @patch("app.main.quant_analysis_manager.submit")
    def test_create_run_returns_manager_result(self, submit) -> None:
        submit.return_value = {"id": "run-1", "status": "queued", "reused": False}

        with TestClient(app) as client:
            response = client.post(
                "/api/quant-analysis/runs",
                json={
                    "ticker": "aapl",
                    "analysisDate": "2026-08-28",
                    "mode": "quick",
                    "analysts": ["technical"],
                    "reflectionEnabled": False,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "run-1")
        request = submit.call_args.args[0]
        self.assertEqual(request.ticker, "AAPL")

    @patch("app.main.quant_analysis_manager.delete")
    def test_delete_run_returns_manager_result(self, delete) -> None:
        delete.return_value = {"id": "run-1", "deleted": True}

        with TestClient(app) as client:
            response = client.delete("/api/quant-analysis/runs/run-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"id": "run-1", "deleted": True})
        delete.assert_called_once_with("run-1")


if __name__ == "__main__":
    unittest.main()
