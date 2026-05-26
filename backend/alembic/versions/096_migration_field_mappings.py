"""Add ``field_mappings`` JSONB column to migrations.

Field mapping lets the admin remap source platform fields to existing
Turbo EA fields on the target card type before applying — so a LeanIX
custom ``criticality`` can land on the TEA built-in ``businessCriticality``
instead of creating a brand-new attribute.

Shape: ``{<source_native_type>: {<source_field_key>: <tea_field_key>}}``.
``None``/empty means "no mapping configured — import as new custom
field" (current behaviour).

Revision ID: 096
Revises: 095
Create Date: 2026-05-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "096"
down_revision: Union[str, None] = "095"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "migrations",
        sa.Column("field_mappings", JSONB(), nullable=True, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("migrations", "field_mappings")
