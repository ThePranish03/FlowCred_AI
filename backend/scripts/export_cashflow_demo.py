#!/usr/bin/env python3
"""Export the demo fixture for the cash-flow dashboard from real model output.

The fixture is generated from the shipped production artifacts through the same
serving code the API uses, so no forecast number is ever hand-written. If the
artifacts are missing the script fails loudly instead of emitting fake data.

Run from the repository root:

    backend/.venv/bin/python backend/scripts/export_cashflow_demo.py
"""

from __future__ import annotations

import datetime as _dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import forecasting  # noqa: E402

OUT = ROOT / "frontend" / "public" / "demo-data"
MANIFEST = OUT / "manifest.json"


def main() -> int:
    loaded = forecasting.load_forecast_models()
    missing = [c for c in forecasting.CURRENCIES if c not in loaded]
    if missing:
        status = forecasting.forecast_status()
        print(f"ERROR: forecast artifacts unavailable for {missing}: {status}", file=sys.stderr)
        return 1

    fixture: dict[str, object] = {
        "generatedAt": _dt.datetime.now(_dt.UTC).isoformat(timespec="seconds"),
        "mode": "demo",
        "note": (
            "Generated from the shipped cash-flow artifacts via the same serving code "
            "as the API. Values are invoice-clearance proxies, not verified cash receipts."
        ),
    }
    for currency in forecasting.CURRENCIES:
        fixture[currency] = {
            str(horizon): forecasting.build_forecast_payload(currency, horizon)
            for horizon in forecasting.HORIZONS
        }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "cashflow.json").write_text(
        json.dumps(fixture, indent=2, default=str) + "\n", encoding="utf-8"
    )

    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        counts = manifest.setdefault("counts", {})
        counts["cashFlowSeries"] = len(forecasting.CURRENCIES) * len(forecasting.HORIZONS)
        notes = manifest.setdefault("notes", [])
        note = (
            "cashflow.json is generated from the shipped Model 4 artifacts; its values are "
            "invoice-clearance proxies labelled as historical simulations, not live forecasts."
        )
        if note not in notes:
            notes.append(note)
        sources = manifest.setdefault("sources", [])
        for extra in ("models/cash_flow_forecaster_usd.joblib", "models/cash_flow_forecaster_cad.joblib"):
            if extra not in sources:
                sources.append(extra)
        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    size = (OUT / "cashflow.json").stat().st_size
    print(f"wrote {OUT.relative_to(ROOT)}/cashflow.json ({size / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
