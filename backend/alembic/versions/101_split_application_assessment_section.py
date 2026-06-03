"""Split the Application card's mixed section into facts + Assessment.

Historically the Application card type bundled objective facts (hosting type,
commercial flag, AI features) and subjective ratings (business criticality,
functional/technical suitability, TIME model) into a single "Application
Information" section. Discussion #632 asked to mirror the BusinessCapability
card's facts-vs-assessment split: the four rating fields now live in a dedicated
"Assessment" section, inserted directly after "Application Information", leaving
only the factual attributes behind ("Cost & Ownership" is untouched).

``seed.py`` only runs for missing card-type rows on startup, so editing the seed
default has no effect on existing installs. This migration restructures the
existing Application row, only when all of the following hold (so admin-
customised layouts are left alone):

- the Application row exists
- a single section named "Application Information" exists
- that section carries all four rating field keys
- no "Assessment" section already exists (idempotent)

The four rating fields are *moved* (their stored definitions — options, weights,
required flags, translations, plus any admin edits — are preserved verbatim),
never recreated.

Crucially, the migration also rewrites ``section_config`` when present. The
frontend renders custom sections by their *position* in ``fields_schema`` as
``custom:N`` keys; a persisted ``section_config.__order`` (written the moment an
admin touches the Card Layout Editor) freezes those indices. Inserting a section
mid-array would otherwise (a) push the new section to the bottom of the card
because its ``custom:N`` key isn't in the stored order, and (b) shift every later
``custom:N`` so the stored order and per-section expand/hide flags point at the
wrong sections. We therefore splice the new section's key in right after
"Application Information" and bump the indices of every later custom section in
both ``__order`` and the per-section config entries.

Revision ID: 101
Revises: 100
Create Date: 2026-06-03
"""

import json
from typing import Optional, Union

import sqlalchemy as sa

from alembic import op

revision: str = "101"
down_revision: Union[str, None] = "100"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


ASSESSMENT_FIELD_KEYS = [
    "businessCriticality",
    "functionalSuitability",
    "technicalSuitability",
    "timeModel",
]

ASSESSMENT_SECTION_TRANSLATIONS = {
    "de": "Bewertung",
    "fr": "Évaluation",
    "es": "Evaluación",
    "it": "Valutazione",
    "pt": "Avaliação",
    "zh": "评估",
    "ru": "Оценка",
    "da": "Vurdering",
}

INFO_SECTION = "Application Information"
ASSESSMENT_SECTION = "Assessment"


# --------------------------------------------------------------------------- #
# Pure helpers (unit-tested in tests/services/test_migration_101_app_split.py) #
# --------------------------------------------------------------------------- #


def _custom_index(schema: list, raw_idx: int) -> int:
    """``custom:N`` index of the section at raw position ``raw_idx``.

    The frontend numbers custom sections by their position among the non-
    ``__description`` sections, so we count those, not raw list positions.
    """
    return sum(1 for s in schema[:raw_idx] if s.get("section") != "__description")


def _parse_custom(token: object) -> Optional[int]:
    if isinstance(token, str) and token.startswith("custom:"):
        try:
            return int(token.split(":", 1)[1])
        except ValueError:
            return None
    return None


def split_schema(schema: list) -> Optional[tuple[list, int]]:
    """Move the four rating fields into a new "Assessment" section.

    Returns ``(new_schema, new_custom_idx)`` or ``None`` if the guard conditions
    aren't met. Mutates ``schema`` in place and also returns it.
    """
    if any(s.get("section") == ASSESSMENT_SECTION for s in schema):
        return None
    info_positions = [i for i, s in enumerate(schema) if s.get("section") == INFO_SECTION]
    if len(info_positions) != 1:
        return None
    info_idx = info_positions[0]
    info_section = schema[info_idx]
    info_fields = info_section.get("fields", [])
    by_key = {f.get("key"): f for f in info_fields}
    if not all(k in by_key for k in ASSESSMENT_FIELD_KEYS):
        return None

    moved = [by_key[k] for k in ASSESSMENT_FIELD_KEYS]
    info_section["fields"] = [f for f in info_fields if f.get("key") not in ASSESSMENT_FIELD_KEYS]
    schema.insert(
        info_idx + 1,
        {
            "section": ASSESSMENT_SECTION,
            "translations": ASSESSMENT_SECTION_TRANSLATIONS,
            "fields": moved,
        },
    )
    return schema, _custom_index(schema, info_idx + 1)


def merge_schema(schema: list) -> Optional[tuple[list, int]]:
    """Reverse of :func:`split_schema`. Returns ``(new_schema, removed_idx)``."""
    info_positions = [i for i, s in enumerate(schema) if s.get("section") == INFO_SECTION]
    assess_positions = [i for i, s in enumerate(schema) if s.get("section") == ASSESSMENT_SECTION]
    if len(info_positions) != 1 or len(assess_positions) != 1:
        return None
    info_idx = info_positions[0]
    assess_idx = assess_positions[0]
    removed_idx = _custom_index(schema, assess_idx)
    moved = schema[assess_idx].get("fields", [])
    # Restore the rating fields to the front of "Application Information".
    schema[info_idx]["fields"] = moved + schema[info_idx].get("fields", [])
    schema.pop(assess_idx)
    return schema, removed_idx


def remap_section_config_insert(section_config: dict, insert_idx: int) -> dict:
    """Shift ``custom:N`` (N >= insert_idx) up by one and splice in the new key.

    Handles both the ``__order`` list and the per-section keyed entries so a
    stored order / expand / hide preference keeps pointing at the same section.
    """
    if not section_config:
        return section_config
    out: dict = {}
    for key, value in section_config.items():
        if key == "__order":
            continue
        n = _parse_custom(key)
        out[f"custom:{n + 1}" if n is not None and n >= insert_idx else key] = value

    order = section_config.get("__order")
    if isinstance(order, list):
        new_order: list = []
        for tok in order:
            n = _parse_custom(tok)
            new_order.append(f"custom:{n + 1}" if n is not None and n >= insert_idx else tok)
        new_key = f"custom:{insert_idx}"
        anchor = f"custom:{insert_idx - 1}"
        if anchor in new_order:
            new_order.insert(new_order.index(anchor) + 1, new_key)
        elif new_key not in new_order:
            new_order.append(new_key)
        out["__order"] = new_order
    return out


def remap_section_config_remove(section_config: dict, remove_idx: int) -> dict:
    """Reverse of :func:`remap_section_config_insert`."""
    if not section_config:
        return section_config
    out: dict = {}
    for key, value in section_config.items():
        if key == "__order":
            continue
        n = _parse_custom(key)
        if n is not None and n == remove_idx:
            continue  # drop the Assessment section's own entry
        out[f"custom:{n - 1}" if n is not None and n > remove_idx else key] = value

    order = section_config.get("__order")
    if isinstance(order, list):
        new_order = []
        for tok in order:
            n = _parse_custom(tok)
            if n is not None and n == remove_idx:
                continue
            new_order.append(f"custom:{n - 1}" if n is not None and n > remove_idx else tok)
        out["__order"] = new_order
    return out


# --------------------------------------------------------------------------- #


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema, section_config FROM card_types WHERE key = 'Application'")
    ).fetchone()
    if not row or not row[0]:
        return
    result = split_schema(list(row[0]))
    if result is None:
        return
    new_schema, insert_idx = result
    new_config = remap_section_config_insert(dict(row[1] or {}), insert_idx)
    conn.execute(
        sa.text(
            "UPDATE card_types SET fields_schema = :s, section_config = :c "
            "WHERE key = 'Application'"
        ),
        {"s": json.dumps(new_schema), "c": json.dumps(new_config)},
    )


def downgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema, section_config FROM card_types WHERE key = 'Application'")
    ).fetchone()
    if not row or not row[0]:
        return
    result = merge_schema(list(row[0]))
    if result is None:
        return
    new_schema, removed_idx = result
    new_config = remap_section_config_remove(dict(row[1] or {}), removed_idx)
    conn.execute(
        sa.text(
            "UPDATE card_types SET fields_schema = :s, section_config = :c "
            "WHERE key = 'Application'"
        ),
        {"s": json.dumps(new_schema), "c": json.dumps(new_config)},
    )
