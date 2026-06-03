"""Repair + normalise the Application facts/assessment split.

Migration 101 split the Application card's "Application Information" section,
moving the four rating fields into a new "Assessment" section. An earlier
iteration of 101 did not rewrite ``section_config``; installs that ran it are
left with two defects:

1. the "Assessment" section renders at the *bottom* of the card, because its
   ``custom:N`` key isn't in the persisted ``section_config.__order`` and the
   frontend appends unknown custom keys last; and
2. in some states a rating field (e.g. ``businessCriticality``) ends up listed
   in *two* sections.

Because 101 is already stamped on those databases, the section-config fix in the
later 101 can never run there. This migration is a fresh revision that repairs
the state forward, idempotently, for the Application type only:

- every rating field appears exactly once, in a single "Assessment" section;
- that section sits directly after "Application Information";
- ``section_config`` is re-keyed by *section name* (so per-section expand/hide
  flags follow their section) and the Assessment key is forced directly after
  the Application-Information key in ``__order`` so it is no longer at the
  bottom.

It is a no-op on a correctly-split install (fresh seed or an install that ran
the hardened 101), so it is safe everywhere.

Revision ID: 102
Revises: 101
Create Date: 2026-06-03
"""

import copy
import json
from typing import Optional, Union

import sqlalchemy as sa

from alembic import op

revision: str = "102"
down_revision: Union[str, None] = "101"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


RATING_KEYS = [
    "businessCriticality",
    "functionalSuitability",
    "technicalSuitability",
    "timeModel",
]

INFO_SECTION = "Application Information"
ASSESSMENT_SECTION = "Assessment"

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


# --------------------------------------------------------------------------- #
# Pure helpers (unit-tested in tests/services/test_alembic_102_app_normalize.py)
# --------------------------------------------------------------------------- #


def _custom_names(schema: list) -> list[str]:
    """Ordered section names that map to ``custom:N`` keys (skip ``__description``)."""
    return [s.get("section") for s in schema if s.get("section") != "__description"]


def normalize_schema(schema: list) -> list:
    """Collapse the rating fields into a single Assessment section after App Info.

    Mutates and returns ``schema``. Idempotent — a correctly-split schema is
    returned unchanged in content.
    """
    # Canonical definition per rating key: prefer the copy already sitting in an
    # "Assessment" section, else the first occurrence anywhere.
    canonical: dict[str, dict] = {}
    for section in schema:
        if section.get("section") == ASSESSMENT_SECTION:
            for field in section.get("fields", []):
                key = field.get("key")
                if key in RATING_KEYS and key not in canonical:
                    canonical[key] = field
    for section in schema:
        for field in section.get("fields", []):
            key = field.get("key")
            if key in RATING_KEYS and key not in canonical:
                canonical[key] = field

    rating_fields = [canonical[k] for k in RATING_KEYS if k in canonical]
    if not rating_fields:
        return schema  # not the Application layout we expect; leave it alone

    # Strip every rating field from every section.
    for section in schema:
        if "fields" in section:
            section["fields"] = [
                f for f in section.get("fields", []) if f.get("key") not in RATING_KEYS
            ]

    # Find / merge the Assessment section (keep the first, drop any extras).
    assess_positions = [i for i, s in enumerate(schema) if s.get("section") == ASSESSMENT_SECTION]
    if assess_positions:
        assess = schema[assess_positions[0]]
        for i in reversed(assess_positions[1:]):
            schema.pop(i)
        assess["fields"] = rating_fields
        assess.setdefault("translations", ASSESSMENT_SECTION_TRANSLATIONS)
        schema.remove(assess)
    else:
        assess = {
            "section": ASSESSMENT_SECTION,
            "translations": ASSESSMENT_SECTION_TRANSLATIONS,
            "fields": rating_fields,
        }

    # Re-insert directly after Application Information (or at the end if absent).
    info_positions = [i for i, s in enumerate(schema) if s.get("section") == INFO_SECTION]
    schema.insert(info_positions[0] + 1 if info_positions else len(schema), assess)
    return schema


def normalize_section_config(
    old_names: list[str], new_names: list[str], section_config: dict
) -> dict:
    """Re-key ``custom:N`` entries by section name and force Assessment after App Info."""
    if not section_config:
        # No stored order → frontend default already places Assessment after App
        # Info, so there is nothing to fix.
        return section_config

    old_idx_to_name = {f"custom:{i}": n for i, n in enumerate(old_names)}
    name_to_new_key = {n: f"custom:{i}" for i, n in enumerate(new_names)}

    out: dict = {}
    for key, value in section_config.items():
        if key == "__order":
            continue
        if isinstance(key, str) and key.startswith("custom:"):
            name = old_idx_to_name.get(key)
            new_key = name_to_new_key.get(name) if name else None
            if new_key is not None:
                out[new_key] = value  # else: section gone, drop the flag
        else:
            out[key] = value

    order = section_config.get("__order")
    if isinstance(order, list):
        new_order: list = []
        seen: set = set()
        for tok in order:
            if isinstance(tok, str) and tok.startswith("custom:"):
                name = old_idx_to_name.get(tok)
                new_key = name_to_new_key.get(name) if name else None
                if new_key is not None and new_key not in seen:
                    new_order.append(new_key)
                    seen.add(new_key)
            elif tok not in seen:
                new_order.append(tok)
                seen.add(tok)
        # Append any custom section missing from the stored order (e.g. a newly
        # created Assessment), so nothing silently disappears.
        for i in range(len(new_names)):
            ck = f"custom:{i}"
            if ck not in seen:
                new_order.append(ck)
                seen.add(ck)
        # Force the Assessment key directly after the Application-Information key.
        info_key = name_to_new_key.get(INFO_SECTION)
        assess_key = name_to_new_key.get(ASSESSMENT_SECTION)
        if info_key in new_order and assess_key in new_order:
            new_order.remove(assess_key)
            new_order.insert(new_order.index(info_key) + 1, assess_key)
        out["__order"] = new_order
    return out


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True)


def plan_repair(schema: list, section_config: dict) -> Optional[tuple[list, dict]]:
    """Return ``(new_schema, new_config)`` if a change is needed, else ``None``."""
    old_names = _custom_names(schema)
    new_schema = normalize_schema(copy.deepcopy(schema))
    new_names = _custom_names(new_schema)
    new_config = normalize_section_config(old_names, new_names, dict(section_config or {}))
    if _canonical(new_schema) == _canonical(schema) and _canonical(new_config) == _canonical(
        section_config or {}
    ):
        return None
    return new_schema, new_config


# --------------------------------------------------------------------------- #


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema, section_config FROM card_types WHERE key = 'Application'")
    ).fetchone()
    if not row or not row[0]:
        return
    plan = plan_repair(list(row[0]), dict(row[1] or {}))
    if plan is None:
        return
    new_schema, new_config = plan
    conn.execute(
        sa.text(
            "UPDATE card_types SET fields_schema = :s, section_config = :c "
            "WHERE key = 'Application'"
        ),
        {"s": json.dumps(new_schema), "c": json.dumps(new_config)},
    )


def downgrade() -> None:
    # This is a forward repair of an inconsistent state; there is no meaningful
    # earlier state to restore to, so downgrade is intentionally a no-op.
    pass
