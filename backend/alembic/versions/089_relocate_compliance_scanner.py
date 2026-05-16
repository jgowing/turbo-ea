"""Relocate the compliance scanner out of TurboLens — table + literal renames.

Final structural piece of the compliance-scanner relocation. The previous
commits handle code-level renames (service file, router, permission registry,
Pydantic schemas, frontend); this migration brings the persisted state in
line.

Three sets of changes, all in one upgrade so a half-applied migration can't
leave the system with mismatched code and data:

1. **Table + index rename.** ``turbolens_compliance_findings`` →
   ``compliance_findings`` (plus its six indexes drop the
   ``ix_turbolens_compliance_findings_*`` prefix in favour of
   ``ix_compliance_findings_*``). The table no longer belongs in the
   TurboLens namespace — it stores GRC compliance findings authored
   manually or produced by a regulation scan, not AI-intelligence output.

2. **Stored discriminator rewrites.** The literal string
   ``"security_compliance"`` was used in three places as a data value:
   - ``turbolens_analysis_runs.analysis_type`` for every compliance scan
   - ``risks.source_type`` for every risk promoted from a compliance finding
   The migration rewrites both to ``"compliance"`` so existing data lines
   up with the new ``AnalysisType.COMPLIANCE`` enum and the new
   ``SourceLiteral`` typing in ``schemas/risk.py``.

3. **JSONB permission rename in roles.** The ``roles.permissions`` JSONB
   column maps permission-key strings → bool. Every role that granted
   ``security_compliance.view`` / ``security_compliance.manage`` now needs
   those keys renamed to ``compliance.view`` / ``compliance.manage``.
   Uses ``jsonb_set`` + ``-`` (subtract operator) idiomatically so we only
   touch keys that exist and preserve the original value. Customers who
   added their own custom roles get the same rename. Customers whose roles
   already use ``compliance.*`` (impossible today but defensive) are
   no-ops.

The downgrade reverses all three in lock-step.

Revision ID: 089
Revises: 088
Create Date: 2026-05-16
"""

from typing import Union

from alembic import op

revision: str = "089"
down_revision: Union[str, None] = "088"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


_INDEX_RENAMES = [
    (
        "ix_turbolens_compliance_findings_regulation_status",
        "ix_compliance_findings_regulation_status",
    ),
    ("ix_turbolens_compliance_findings_card_id", "ix_compliance_findings_card_id"),
    ("ix_turbolens_compliance_findings_run_id", "ix_compliance_findings_run_id"),
    ("ix_turbolens_compliance_findings_risk_id", "ix_compliance_findings_risk_id"),
    ("ix_turbolens_compliance_findings_finding_key", "ix_compliance_findings_finding_key"),
    ("ix_turbolens_compliance_findings_decision", "ix_compliance_findings_decision"),
]


def upgrade() -> None:
    # 1. Rename table + indexes.
    op.rename_table("turbolens_compliance_findings", "compliance_findings")
    for old_name, new_name in _INDEX_RENAMES:
        op.execute(f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"')

    # 2. Rewrite stored discriminator strings.
    op.execute(
        "UPDATE turbolens_analysis_runs SET analysis_type = 'compliance' "
        "WHERE analysis_type = 'security_compliance'"
    )
    op.execute(
        "UPDATE risks SET source_type = 'compliance' WHERE source_type = 'security_compliance'"
    )

    # 3. Rename the two permission keys inside roles.permissions (JSONB).
    # For each row that has the old key, copy its value to the new key
    # and drop the old key. ``jsonb_set`` requires the path to exist
    # only on the right-hand side; the ``-`` operator unconditionally
    # removes the old key (no-op if absent).
    op.execute(
        """
        UPDATE roles
        SET permissions = jsonb_set(
            permissions - 'security_compliance.view',
            '{compliance.view}',
            permissions->'security_compliance.view',
            true
        )
        WHERE permissions ? 'security_compliance.view'
        """
    )
    op.execute(
        """
        UPDATE roles
        SET permissions = jsonb_set(
            permissions - 'security_compliance.manage',
            '{compliance.manage}',
            permissions->'security_compliance.manage',
            true
        )
        WHERE permissions ? 'security_compliance.manage'
        """
    )


def downgrade() -> None:
    # Permission keys back to security_compliance.*
    op.execute(
        """
        UPDATE roles
        SET permissions = jsonb_set(
            permissions - 'compliance.manage',
            '{security_compliance.manage}',
            permissions->'compliance.manage',
            true
        )
        WHERE permissions ? 'compliance.manage'
        """
    )
    op.execute(
        """
        UPDATE roles
        SET permissions = jsonb_set(
            permissions - 'compliance.view',
            '{security_compliance.view}',
            permissions->'compliance.view',
            true
        )
        WHERE permissions ? 'compliance.view'
        """
    )

    # Discriminators back to security_compliance.
    op.execute(
        "UPDATE risks SET source_type = 'security_compliance' WHERE source_type = 'compliance'"
    )
    op.execute(
        "UPDATE turbolens_analysis_runs SET analysis_type = 'security_compliance' "
        "WHERE analysis_type = 'compliance'"
    )

    # Indexes + table back.
    for old_name, new_name in _INDEX_RENAMES:
        op.execute(f'ALTER INDEX "{new_name}" RENAME TO "{old_name}"')
    op.rename_table("compliance_findings", "turbolens_compliance_findings")
