import os
import py_compile
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from app import main

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = Path(__file__).resolve().parents[1]
HELPER_SOURCE = BACKEND_DIR / "feature_engineering_utils.py"
HELPER_BYTECODE = BACKEND_DIR / "vendor" / f"feature_engineering_utils.{sys.implementation.cache_tag}.pyc"
if not HELPER_SOURCE.exists():
    HELPER_SOURCE = ROOT / HELPER_SOURCE.name
    HELPER_BYTECODE = ROOT / "vendor" / HELPER_BYTECODE.name


def _import_helper_in_isolated_root(root: Path) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(root)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import feature_engineering_utils as helper; "
            "assert sys.modules['feature_engineering_utils'] is helper; "
            "assert helper.__name__ == 'feature_engineering_utils'; "
            "assert helper.LeakageSafeCustomerHistoryTransformer.__module__ == helper.__name__; "
            "assert callable(helper.build_feature_pipeline); print('helper loaded')",
        ],
        cwd=root,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )


def _request_health(database):
    previous_override = main.app.dependency_overrides.get(main.get_db)
    main.app.dependency_overrides[main.get_db] = lambda: database
    try:
        return TestClient(main.app).get("/api/v1/health")
    finally:
        if previous_override is None:
            main.app.dependency_overrides.pop(main.get_db, None)
        else:
            main.app.dependency_overrides[main.get_db] = previous_override


def test_recovered_helper_loads_original_module_despite_wrapper_cache(tmp_path):
    shutil.copy2(HELPER_SOURCE, tmp_path / HELPER_SOURCE.name)
    vendor_dir = tmp_path / "vendor"
    vendor_dir.mkdir()
    shutil.copy2(HELPER_BYTECODE, vendor_dir / HELPER_BYTECODE.name)

    cache_dir = tmp_path / "__pycache__"
    cache_dir.mkdir()
    py_compile.compile(
        str(tmp_path / HELPER_SOURCE.name),
        cfile=str(cache_dir / HELPER_BYTECODE.name),
        doraise=True,
    )

    result = _import_helper_in_isolated_root(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "helper loaded" in result.stdout


def test_recovered_helper_reports_missing_bytecode(tmp_path):
    shutil.copy2(HELPER_SOURCE, tmp_path / HELPER_SOURCE.name)

    result = _import_helper_in_isolated_root(tmp_path)

    assert result.returncode != 0
    assert "Original feature_engineering_utils bytecode is missing" in result.stderr
    assert "restore the CPython 3.14 vendor artifact" in result.stderr


def test_recovered_helper_reports_incompatible_bytecode(tmp_path):
    shutil.copy2(HELPER_SOURCE, tmp_path / HELPER_SOURCE.name)
    vendor_dir = tmp_path / "vendor"
    vendor_dir.mkdir()
    bytecode = vendor_dir / HELPER_BYTECODE.name
    shutil.copy2(HELPER_BYTECODE, bytecode)
    bytecode.write_bytes(b"\x00\x00\x00\x00" + bytecode.read_bytes()[4:])

    result = _import_helper_in_isolated_root(tmp_path)

    assert result.returncode != 0
    assert "Original feature_engineering_utils bytecode is incompatible with CPython 3.14" in result.stderr


def test_load_models_validates_all_saved_models_and_pipelines(monkeypatch):
    monkeypatch.setattr(main, "MODEL_DIR", ROOT / "models")
    monkeypatch.setattr(main, "DATA_DIR", ROOT / "data")
    monkeypatch.setattr(main, "MODEL_STATUS", {})

    main.load_models()

    assert set(main.MODEL_STATUS) == set(main.MODEL_IDS)
    assert all(main.MODEL_STATUS[key]["status"] == "available" for key in main.MODEL_IDS)
    assert all(main.MODEL_STATUS[key]["model"] is not None for key in main.MODEL_IDS)
    assert all(main.MODEL_STATUS[key]["pipeline"] is not None for key in main.MODEL_IDS)
    assert {"history_transformer", "feature_pipeline"}.issubset(main.MODEL_STATUS["late-payment"]["pipeline"])
    assert {"preprocess", "numeric_features", "categorical_features"}.issubset(main.MODEL_STATUS["payment-delay"]["pipeline"])
    assert {"pipeline", "features"}.issubset(main.MODEL_STATUS["clustering"]["pipeline"])


def test_health_returns_200_when_database_and_all_models_are_ready(monkeypatch):
    monkeypatch.setattr(
        main,
        "MODEL_STATUS",
        {key: {"status": "available", "version": "verified"} for key in main.MODEL_IDS},
    )

    class AvailableDatabase:
        def execute(self, _statement):
            return None

    response = _request_health(AvailableDatabase())

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"]["status"] == "available"
    assert all(model["status"] == "available" for model in response.json()["models"])


def test_missing_model_artifacts_prevent_healthy_response(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "MODEL_DIR", tmp_path / "missing-models")
    monkeypatch.setattr(main, "MODEL_STATUS", {})

    main.load_models()

    assert all(main.MODEL_STATUS[key]["status"] == "unavailable" for key in main.MODEL_IDS)

    class AvailableDatabase:
        def execute(self, _statement):
            return None

    response = _request_health(AvailableDatabase())

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    assert all(model["status"] == "unavailable" for model in payload["models"])
    assert str(tmp_path) not in response.text


def test_database_unavailable_returns_503_without_exposing_connection_details(monkeypatch):
    monkeypatch.setattr(
        main,
        "MODEL_STATUS",
        {key: {"status": "available", "version": "verified"} for key in main.MODEL_IDS},
    )

    class UnavailableDatabase:
        def execute(self, _statement):
            raise RuntimeError("database connection rejected")

    response = _request_health(UnavailableDatabase())

    assert response.status_code == 503
    payload = response.json()
    assert payload["database"]["error"] == "Database connectivity check failed"
    assert "connection rejected" not in response.text
