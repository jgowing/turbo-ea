"""Unit tests for migration 101 (split Application facts from assessment).

The migration moves four rating fields out of the Application card's
"Application Information" section into a new "Assessment" section and rewrites
``section_config`` so a persisted ``__order`` / per-section flags keep pointing
at the right sections. These tests exercise the pure helpers directly (no DB
needed) and assert:

- the rating fields are *moved* verbatim, not recreated;
- the new section lands directly after "Application Information";
- ``section_config.__order`` and keyed entries are re-indexed correctly so the
  new section is never pushed to the bottom and later sections keep their flags;
- the operation is idempotent / guarded against customised layouts;
- upgrade is exactly reversed by downgrade (schema + section_config round-trip);
- the result matches the post-split layout shipped in ``seed.py``.
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "101_split_application_assessment_section.py"
)
_spec = importlib.util.spec_from_file_location("mig101", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def _legacy_app_schema() -> list:
    """The pre-split Application fields_schema (ratings mixed with facts)."""
    return [
        {
            "section": "Application Information",
            "translations": {"de": "Anwendungsinformationen"},
            "fields": [
                {"key": "businessCriticality", "type": "single_select", "required": True},
                {"key": "functionalSuitability", "type": "single_select"},
                {"key": "technicalSuitability", "type": "single_select"},
                {"key": "timeModel", "type": "single_select", "required": True},
                {"key": "hostingType", "type": "single_select"},
                {"key": "commercialApplication", "type": "boolean"},
                {"key": "hasAiFeatures", "type": "boolean"},
            ],
        },
        {
            "section": "Cost & Ownership",
            "translations": {"de": "Kosten & Eigentümerschaft"},
            "fields": [
                {"key": "costTotalAnnual", "type": "cost"},
                {"key": "numberOfUsers", "type": "number"},
                {"key": "productName", "type": "text"},
            ],
        },
    ]


def _sections(schema: list) -> list[str]:
    return [s["section"] for s in schema]


def _keys(schema: list, section: str) -> list[str]:
    sec = next(s for s in schema if s["section"] == section)
    return [f["key"] for f in sec["fields"]]


# --------------------------------------------------------------------------- #
# split_schema
# --------------------------------------------------------------------------- #


def test_split_moves_ratings_into_new_section_after_info():
    schema = _legacy_app_schema()
    result = mig.split_schema(schema)
    assert result is not None
    new_schema, insert_idx = result

    # Assessment is inserted directly after Application Information.
    assert _sections(new_schema) == [
        "Application Information",
        "Assessment",
        "Cost & Ownership",
    ]
    assert insert_idx == 1  # custom:1, right after Application Information (custom:0)

    # Facts stay behind; ratings move; Cost & Ownership untouched.
    assert _keys(new_schema, "Application Information") == [
        "hostingType",
        "commercialApplication",
        "hasAiFeatures",
    ]
    assert _keys(new_schema, "Assessment") == mig.ASSESSMENT_FIELD_KEYS
    assert _keys(new_schema, "Cost & Ownership") == [
        "costTotalAnnual",
        "numberOfUsers",
        "productName",
    ]

    # New section carries full translations for all 8 non-English locales.
    assessment = next(s for s in new_schema if s["section"] == "Assessment")
    assert set(assessment["translations"]) == {
        "de",
        "fr",
        "es",
        "it",
        "pt",
        "zh",
        "ru",
        "da",
    }


def test_split_preserves_field_definitions_verbatim():
    """Fields are *moved* (same dict identity/content), never recreated."""
    schema = _legacy_app_schema()
    original_time = next(f for f in schema[0]["fields"] if f["key"] == "timeModel")

    new_schema = mig.split_schema(schema)[0]
    assessment = next(s for s in new_schema if s["section"] == "Assessment")
    moved_time = next(f for f in assessment["fields"] if f["key"] == "timeModel")

    assert moved_time is original_time  # same object, definition preserved


def test_split_is_idempotent_when_assessment_exists():
    schema = _legacy_app_schema()
    assert mig.split_schema(schema) is not None
    # Running again on the already-split schema is a no-op (guard trips).
    assert mig.split_schema(schema) is None


def test_split_skips_customised_layout_missing_a_rating_field():
    schema = _legacy_app_schema()
    # Admin removed timeModel from the Application Information section.
    schema[0]["fields"] = [f for f in schema[0]["fields"] if f["key"] != "timeModel"]
    assert mig.split_schema(schema) is None


def test_split_skips_when_no_application_information_section():
    schema = _legacy_app_schema()
    schema[0]["section"] = "Renamed By Admin"
    assert mig.split_schema(schema) is None


# --------------------------------------------------------------------------- #
# section_config remap on insert
# --------------------------------------------------------------------------- #


def test_remap_insert_reindexes_order_and_splices_new_key():
    # custom:0 = App Info, custom:1 = Cost & Ownership in the stored order.
    cfg = {
        "__order": ["description", "custom:0", "custom:1", "lifecycle", "tags", "relations"],
        "custom:1": {"defaultExpanded": False},
    }
    out = mig.remap_section_config_insert(cfg, 1)

    # Cost shifts to custom:2; new Assessment (custom:1) lands right after App Info.
    assert out["__order"] == [
        "description",
        "custom:0",
        "custom:1",
        "custom:2",
        "lifecycle",
        "tags",
        "relations",
    ]
    # The collapse flag that belonged to Cost & Ownership follows it to custom:2.
    assert out["custom:2"] == {"defaultExpanded": False}
    assert "custom:1" not in out  # custom:1 now means Assessment, which has no stored flag


def test_remap_insert_handles_reordered_custom_sections():
    # Admin placed Cost (custom:1) before App Info (custom:0).
    cfg = {"__order": ["description", "custom:1", "custom:0", "relations"]}
    out = mig.remap_section_config_insert(cfg, 1)
    # Cost -> custom:2 (kept in its spot); Assessment (custom:1) spliced after App Info.
    assert out["__order"] == ["description", "custom:2", "custom:0", "custom:1", "relations"]


def test_remap_insert_noop_on_empty_config():
    assert mig.remap_section_config_insert({}, 1) == {}
    assert mig.remap_section_config_insert(None, 1) is None


# --------------------------------------------------------------------------- #
# Round-trip: upgrade logic is exactly reversed by downgrade logic
# --------------------------------------------------------------------------- #


def test_schema_round_trip_restores_original():
    original = _legacy_app_schema()
    schema = copy.deepcopy(original)

    split = mig.split_schema(schema)
    assert split is not None
    merged = mig.merge_schema(split[0])
    assert merged is not None

    assert _sections(merged[0]) == ["Application Information", "Cost & Ownership"]
    assert _keys(merged[0], "Application Information") == _keys(original, "Application Information")
    assert _keys(merged[0], "Cost & Ownership") == _keys(original, "Cost & Ownership")


def test_section_config_round_trip_restores_original():
    cfg = {
        "__order": ["description", "custom:0", "custom:1", "relations"],
        "custom:0": {"defaultExpanded": True},
        "custom:1": {"hidden": True},
    }
    inserted = mig.remap_section_config_insert(copy.deepcopy(cfg), 1)
    restored = mig.remap_section_config_remove(inserted, 1)
    assert restored == cfg


# --------------------------------------------------------------------------- #
# The split must reproduce what seed.py ships for fresh installs
# --------------------------------------------------------------------------- #


def test_split_matches_seed_layout():
    from app.services.seed import TYPES

    app_type = next(t for t in TYPES if t["key"] == "Application")
    seed_layout = {s["section"]: [f["key"] for f in s["fields"]] for s in app_type["fields_schema"]}

    migrated = mig.split_schema(_legacy_app_schema())[0]
    migrated_layout = {s["section"]: [f["key"] for f in s["fields"]] for s in migrated}

    assert migrated_layout == seed_layout
