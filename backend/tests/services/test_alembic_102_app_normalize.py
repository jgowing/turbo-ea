"""Unit tests for migration 102 (repair/normalise the Application split).

Migration 102 forward-repairs databases left inconsistent by the earlier
iteration of migration 101: a rating field duplicated across two sections and
an "Assessment" section stuck at the bottom of the card. These tests exercise
the pure helpers (no DB) and assert the repair is correct and idempotent.
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "102_normalize_application_assessment.py"
)
_spec = importlib.util.spec_from_file_location("mig102", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def _fld(key: str) -> dict:
    return {"key": key, "type": "single_select"}


def _sec(name: str, keys: list[str]) -> dict:
    return {"section": name, "translations": {"de": name}, "fields": [_fld(k) for k in keys]}


def _names(schema: list) -> list[str]:
    return [s["section"] for s in schema]


def _keys(schema: list, section: str) -> list[str]:
    sec = next(s for s in schema if s["section"] == section)
    return [f["key"] for f in sec["fields"]]


def _correct_schema() -> list:
    """A correctly-split Application layout (the desired end state)."""
    return [
        _sec("Application Information", ["hostingType", "commercialApplication", "hasAiFeatures"]),
        _sec(
            "Assessment",
            ["businessCriticality", "functionalSuitability", "technicalSuitability", "timeModel"],
        ),
        _sec("Cost & Ownership", ["costTotalAnnual", "numberOfUsers", "productName"]),
    ]


# --------------------------------------------------------------------------- #
# normalize_schema
# --------------------------------------------------------------------------- #


def test_dedupes_rating_field_present_in_two_sections():
    # businessCriticality (and the others) duplicated: still in App Info AND in Assessment.
    broken = [
        _sec(
            "Application Information",
            [
                "businessCriticality",
                "functionalSuitability",
                "technicalSuitability",
                "timeModel",
                "hostingType",
                "commercialApplication",
                "hasAiFeatures",
            ],
        ),
        _sec("Cost & Ownership", ["costTotalAnnual"]),
        _sec(
            "Assessment",
            ["businessCriticality", "functionalSuitability", "technicalSuitability", "timeModel"],
        ),
    ]
    out = mig.normalize_schema(copy.deepcopy(broken))

    # Each rating field appears exactly once, only in Assessment.
    flat = [f["key"] for s in out for f in s["fields"]]
    for k in mig.RATING_KEYS:
        assert flat.count(k) == 1
    assert _keys(out, "Assessment") == mig.RATING_KEYS
    assert _keys(out, "Application Information") == [
        "hostingType",
        "commercialApplication",
        "hasAiFeatures",
    ]
    # Assessment sits directly after Application Information.
    assert _names(out) == ["Application Information", "Assessment", "Cost & Ownership"]


def test_creates_assessment_when_missing():
    legacy = [
        _sec(
            "Application Information",
            [
                "businessCriticality",
                "functionalSuitability",
                "technicalSuitability",
                "timeModel",
                "hostingType",
            ],
        ),
        _sec("Cost & Ownership", ["costTotalAnnual"]),
    ]
    out = mig.normalize_schema(copy.deepcopy(legacy))
    assert _names(out) == ["Application Information", "Assessment", "Cost & Ownership"]
    assert _keys(out, "Assessment") == mig.RATING_KEYS
    assert _keys(out, "Application Information") == ["hostingType"]


def test_idempotent_on_correct_schema():
    schema = _correct_schema()
    out = mig.normalize_schema(copy.deepcopy(schema))
    assert _names(out) == _names(schema)
    assert _keys(out, "Assessment") == _keys(schema, "Assessment")
    assert _keys(out, "Application Information") == _keys(schema, "Application Information")


# --------------------------------------------------------------------------- #
# normalize_section_config
# --------------------------------------------------------------------------- #


def test_section_config_moves_assessment_out_of_the_bottom():
    # Stale order from before the split: only 2 custom sections were known, and a
    # later edit appended Assessment last.
    old_names = ["Application Information", "Cost & Ownership", "Assessment"]
    new_names = ["Application Information", "Assessment", "Cost & Ownership"]
    cfg = {
        "__order": ["description", "custom:0", "custom:1", "lifecycle", "custom:2"],
        "custom:1": {"defaultExpanded": False},  # Cost & Ownership flag
    }
    out = mig.normalize_section_config(old_names, new_names, cfg)

    # custom keys after re-key: App Info=0, Assessment=1, Cost=2.
    # Cost's collapse flag (was custom:1) follows it to custom:2.
    assert out["custom:2"] == {"defaultExpanded": False}
    # Assessment (custom:1) is no longer at the bottom — it's right after App Info.
    order = out["__order"]
    assert order.index("custom:1") == order.index("custom:0") + 1
    assert order[-1] != "custom:1"


def test_section_config_noop_when_empty():
    assert (
        mig.normalize_section_config(["Application Information"], ["Application Information"], {})
        == {}
    )


# --------------------------------------------------------------------------- #
# plan_repair (end-to-end change detection)
# --------------------------------------------------------------------------- #


def test_plan_repair_returns_none_when_already_correct():
    assert mig.plan_repair(_correct_schema(), {}) is None
    # Correct schema with a sensible explicit order is also a no-op.
    cfg = {"__order": ["description", "custom:0", "custom:1", "custom:2", "relations"]}
    assert mig.plan_repair(_correct_schema(), cfg) is None


def test_plan_repair_fixes_duplicate_and_order_together():
    broken_schema = [
        _sec(
            "Application Information",
            [
                "businessCriticality",
                "functionalSuitability",
                "technicalSuitability",
                "timeModel",
                "hostingType",
                "commercialApplication",
                "hasAiFeatures",
            ],
        ),
        _sec(
            "Assessment",
            ["businessCriticality", "functionalSuitability", "technicalSuitability", "timeModel"],
        ),
        _sec("Cost & Ownership", ["costTotalAnnual"]),
    ]
    # Order lists Assessment (custom:1) last.
    cfg = {"__order": ["description", "custom:0", "custom:2", "custom:1"]}
    plan = mig.plan_repair(broken_schema, cfg)
    assert plan is not None
    new_schema, new_cfg = plan

    flat = [f["key"] for s in new_schema for f in s["fields"]]
    for k in mig.RATING_KEYS:
        assert flat.count(k) == 1
    assert _names(new_schema) == ["Application Information", "Assessment", "Cost & Ownership"]
    order = new_cfg["__order"]
    assert order.index("custom:1") == order.index("custom:0") + 1
