"""Model 4 tests: target construction, weekly derivation, allocation maths,
chronological folds, leakage guards and the serving contract.

These tests exercise the real code paths used in training and serving. They do
not require the raw dataset: fixtures build a small synthetic invoice frame so
the assertions stay deterministic and fast.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from app import cash_flow_target as T
from app import forecasting as F

from scripts.cashflow import harness as H
from scripts.cashflow.baselines import DueDateForecaster, SeasonalNaive, build_series


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _invoice(invoice_id, amount, currency, status, payment_date, due_date, invoice_date):
    return {
        "invoice_id": invoice_id,
        "invoice_amount": amount,
        "invoice_currency": currency,
        "invoice_status": status,
        "payment_date": payment_date,
        "due_date": due_date,
        "invoice_date": invoice_date,
    }


@pytest.fixture
def synthetic_invoices() -> pd.DataFrame:
    """Two currencies, one genuine zero day, one open invoice, one USD-zero day."""
    rows = [
        # USD, 2019-01-07 (Mon) .. 2019-01-13 (Sun)
        _invoice("U1", 100.0, "USD", "paid", "2019-01-07", "2019-01-05", "2019-01-01"),
        _invoice("U2", 200.0, "USD", "paid", "2019-01-08", "2019-01-06", "2019-01-02"),
        # genuine zero: no USD invoice on 2019-01-09
        _invoice("U3", 50.0, "USD", "paid", "2019-01-10", "2019-01-08", "2019-01-03"),
        # CAD
        _invoice("C1", 75.0, "CAD", "paid", "2019-01-07", "2019-01-05", "2019-01-01"),
        _invoice("C2", 25.0, "CAD", "paid", "2019-01-11", "2019-01-09", "2019-01-04"),
        # excluded: open, foreign currency, out of window, non-positive
        _invoice("O1", 999.0, "USD", "open", None, "2019-02-01", "2019-01-01"),
        _invoice("X1", 999.0, "EUR", "paid", "2019-01-07", "2019-01-05", "2019-01-01"),
        _invoice("T1", 999.0, "USD", "paid", "2020-04-01", "2020-03-01", "2020-02-01"),
        _invoice("Z1", 0.0, "USD", "paid", "2019-01-12", "2019-01-10", "2019-01-05"),
    ]
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Target construction
# ---------------------------------------------------------------------------
def test_target_contract_columns_and_window(synthetic_invoices):
    target = T.build_target(synthetic_invoices)
    assert list(target.columns) == list(T.TARGET_COLUMNS)
    days = (T.OBSERVED_END - T.OBSERVED_START).days + 1
    assert len(target) == days * 2
    assert set(target["currency"].unique()) == {"USD", "CAD"}


def test_currency_separation(synthetic_invoices):
    target = T.build_target(synthetic_invoices)
    usd = target[(target["currency"] == "USD") & (target["date"] == dt.date(2019, 1, 7))]
    cad = target[(target["currency"] == "CAD") & (target["date"] == dt.date(2019, 1, 7))]
    assert usd["collections"].iloc[0] == 100.0
    assert cad["collections"].iloc[0] == 75.0


def test_genuine_zero_days_are_preserved_not_filled(synthetic_invoices):
    target = T.build_target(synthetic_invoices)
    zero_day = target[(target["currency"] == "USD") & (target["date"] == dt.date(2019, 1, 9))]
    assert zero_day["collections"].iloc[0] == 0.0
    assert zero_day["invoice_count"].iloc[0] == 0
    # The next real day keeps its own value; nothing was carried forward.
    nxt = target[(target["currency"] == "USD") & (target["date"] == dt.date(2019, 1, 10))]
    assert nxt["collections"].iloc[0] == 50.0


def test_non_paid_foreign_out_of_window_and_zero_amount_are_dropped(synthetic_invoices):
    target = T.build_target(synthetic_invoices)
    assert target["collections"].sum() == pytest.approx(100 + 200 + 50 + 75 + 25)
    # 2019-01-04 belongs to the truncated first week: flagged incomplete.
    first = target[(target["date"] == dt.date(2019, 1, 4))]
    assert not first["is_complete"].any()
    # 2019-01-07 starts the first fully bounded week.
    monday = target[(target["date"] == dt.date(2019, 1, 7))]
    assert monday["is_complete"].all()


def test_truncated_weeks_are_excluded_from_weekly_series(synthetic_invoices):
    target = T.build_target(synthetic_invoices)
    weekly = T.weekly_from_daily(target)
    starts = set(weekly["week_start"])
    assert dt.date(2018, 12, 31) not in starts
    assert dt.date(2020, 3, 9) not in starts
    assert all(ws >= T.FIRST_COMPLETE_WEEK and ws <= T.LAST_COMPLETE_WEEK for ws in starts)
    assert weekly.groupby("currency")["week_start"].nunique().eq(61).all()


def test_weekly_sums_match_complete_days(synthetic_invoices):
    target = T.build_target(synthetic_invoices)
    weekly = T.weekly_from_daily(target)
    for ccy in T.SUPPORTED_CURRENCIES:
        daily_sum = target.loc[
            (target["currency"] == ccy) & target["is_complete"], "collections"
        ].sum()
        weekly_sum = weekly.loc[weekly["currency"] == ccy, "collections"].sum()
        assert weekly_sum == pytest.approx(daily_sum)


# ---------------------------------------------------------------------------
# Harness: folds and allocation
# ---------------------------------------------------------------------------
def _series(values, currency="USD") -> H.Series:
    n = len(values)
    starts = [dt.date(2019, 1, 7) + dt.timedelta(days=7 * i) for i in range(n)]
    days = [s + dt.timedelta(days=k) for s in starts for k in range(7)]
    daily = pd.DataFrame({"collections": np.repeat(np.array(values, dtype=float) / 7, 7)}, index=days)
    return H.Series(
        currency=currency,
        week_starts=starts,
        values=np.asarray(values, dtype=float),
        daily=daily,
        shares={i: 1 / 7 for i in range(7)},
    )


def test_folds_are_chronological_and_never_use_future_weeks():
    values = list(range(30))
    series = _series(values)
    results = H.run_folds(series, SeasonalNaive(), [20, 22, 24], 5)
    assert [r.origin for r in results] == [20, 22, 24]
    for res in results:
        assert len(res.step_actual) == 5
        # Naive carries the last observed week, so the first prediction equals it.
        assert res.step_predicted[0] == pytest.approx(values[res.origin])
        # Actuals start at origin+1 and never overlap the training window.
        assert res.step_actual[0] == pytest.approx(values[res.origin + 1])


def test_seasonal_naive_ignores_future_values():
    """Changing weeks after the origin must not change the prediction."""
    base = [10.0] * 25
    mutated = base[:21] + [999999.0] * 4  # only weeks after origin 20 change
    r1 = H.run_folds(_series(base), SeasonalNaive(), [20], 3)[0]
    r2 = H.run_folds(_series(mutated), SeasonalNaive(), [20], 3)[0]
    assert r1.step_predicted == r2.step_predicted


def test_daily_allocation_sums_to_horizon_total():
    values = [700.0, 1400.0, 2100.0, 2800.0, 3500.0]
    series = _series(values)
    shares = series.shares_upto(3)
    weekly_pred = {series.week_starts[4]: 1000.0}
    as_of = series.week_starts[3] + dt.timedelta(days=6)  # Sunday
    total = H.horizon_total(weekly_pred, shares, as_of, 7)
    days = H.allocate_daily(weekly_pred, shares, H.horizon_dates(as_of, 7))
    assert sum(days) == pytest.approx(total, abs=0.01)
    assert sum(days) == pytest.approx(1000.0, abs=0.01)


def test_partial_week_allocation_is_not_uniform_division():
    """A 3-day slice of a week must not equal week_total / 7 * 3."""
    shares = {0: 0.2, 1: 0.2, 2: 0.2, 3: 0.15, 4: 0.2, 5: 0.05, 6: 0.0}
    weekly_pred = {dt.date(2020, 3, 9): 1000.0}
    as_of = dt.date(2020, 3, 8)  # Sunday -> horizon starts Monday
    total = H.horizon_total(weekly_pred, shares, as_of, 3)
    assert total == pytest.approx(1000.0 * (0.2 + 0.2 + 0.2))
    assert total != pytest.approx(1000.0 / 7 * 3)


# ---------------------------------------------------------------------------
# Serving maths
# ---------------------------------------------------------------------------
def _artifact_stub(currency="USD") -> dict:
    starts = [str(dt.date(2020, 2, 24) + dt.timedelta(days=7 * i)) for i in range(4)]
    return {
        "algorithm": "seasonal_naive",
        "currency": currency,
        "version": "1.0.0",
        "trained_through": "2020-03-08",
        "frequency": "W-MON",
        "history_week_starts": starts,
        "history_values": [1000.0, 1100.0, 1200.0, 1300.0],
        "weekday_shares": {str(i): v for i, v in enumerate([0.2, 0.2, 0.2, 0.15, 0.2, 0.05, 0.0])},
        "replay": {"2020-03-08": [1300.0 + 50 * k for k in range(13)]},
        "replay_steps": 13,
        "interval_quantiles": {str(k): {"p10": -100.0, "p90": 100.0} for k in range(1, 14)},
        "selection": {"reason": "test fixture"},
    }


@pytest.fixture
def loaded_forecast(monkeypatch):
    artifact = _artifact_stub()
    monkeypatch.setitem(F._FORECAST_MODELS, "USD", artifact)
    monkeypatch.setitem(F.FORECAST_STATUS, "USD", {"available": True, "algorithm": "seasonal_naive"})
    return artifact


def test_forecast_weekly_requires_supported_horizon(loaded_forecast):
    with pytest.raises(F.ForecastError):
        F.forecast_weekly("USD", 14, None)


def test_unknown_currency_is_rejected(loaded_forecast):
    with pytest.raises(F.ForecastError):
        F.forecast_weekly("EUR", 7, None)


def test_unknown_as_of_is_rejected_with_supported_range(loaded_forecast):
    with pytest.raises(F.ForecastError):
        F.forecast_weekly("USD", 7, "2019-01-06")


@pytest.mark.parametrize("horizon", [7, 30, 90])
def test_horizon_total_equals_sum_of_daily_estimates(loaded_forecast, horizon):
    payload = F.build_forecast_payload("USD", horizon)
    daily_sum = sum(d["estimated"] for d in payload["daily"])
    assert payload["totals"]["predicted"] == pytest.approx(daily_sum, abs=0.01)
    assert len(payload["daily"]) == horizon
    assert all(d["isEstimate"] is True for d in payload["daily"])


def test_interval_ordering_everywhere(loaded_forecast):
    payload = F.build_forecast_payload("USD", 30)
    for day in payload["daily"]:
        assert day["lower"] <= day["estimated"] <= day["upper"]
    for week in payload["weekly"]:
        assert week["lower"] <= week["predicted"] <= week["upper"]
    totals = payload["totals"]
    assert totals["lower"] <= totals["predicted"] <= totals["upper"]


def test_payload_labels_historical_simulation_and_proxy(loaded_forecast):
    payload = F.build_forecast_payload("USD", 7)
    # The dataset ends in 2020, so every published forecast is a simulation.
    assert payload["isHistoricalSimulation"] is True
    assert payload["isReplay"] is False  # asOf == trainedThrough
    assert payload["dataPeriod"]["end"] == "2020-03-13"
    assert payload["frequency"] == "weekly"
    assert "proxy" in payload["disclaimer"].lower()
    assert payload["proxy"]["payment_proxy"] is True
    assert payload["proxy"]["requires_payment_ledger_for_verified_cash"] is True


def test_forecast_status_is_separate_from_core_model_health(monkeypatch):
    monkeypatch.setitem(F.FORECAST_STATUS, "USD", {"available": False, "error": "missing"})
    monkeypatch.setitem(F.FORECAST_STATUS, "CAD", {"available": False, "error": "missing"})
    status = F.forecast_status()
    assert status["status"] == "unavailable"
    assert {m["currency"] for m in status["models"]} == {"USD", "CAD"}


# ---------------------------------------------------------------------------
# Due-date baseline leakage guard
# ---------------------------------------------------------------------------
def test_due_date_baseline_ignores_invoices_issued_after_the_origin():
    """An invoice issued after the origin must not appear in the schedule."""
    rows = [
        # known at origin (issued before 2019-01-07)
        _invoice("D1", 500.0, "USD", "open", None, "2019-01-16", "2019-01-02"),
        # issued after the origin -> must be invisible
        _invoice("D2", 4000.0, "USD", "open", None, "2019-01-16", "2019-01-20"),
    ]
    invoices = pd.DataFrame(rows)
    series = _series([100.0] * 10)
    # origin = week of 2019-01-07 (ends Sun 2019-01-13); next week starts 2019-01-14
    model = DueDateForecaster(invoices, "USD").fit(series, 0)
    predicted = model.predict(1)
    assert predicted[0] == pytest.approx(500.0), (
        "future-issued invoice leaked into the due-date schedule"
    )
