"""Integration tests for the app-portfolio report endpoint.

GET /reports/app-portfolio is a complex endpoint with relation resolution,
groupable type detection, organization mapping, and field schema exposure.
Previously had zero test coverage.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


@pytest.fixture
async def portfolio_env(db):
    """Set up types and relations for app-portfolio tests."""
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"reports.portfolio": False},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                    {
                        "key": "businessCriticality",
                        "label": "Criticality",
                        "type": "single_select",
                        "weight": 1,
                    },
                ],
            }
        ],
    )
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="BusinessCapability", label="Business Capability")

    await create_relation_type(
        db,
        key="app_to_itc",
        label="App to ITC",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    await create_relation_type(
        db,
        key="app_to_org",
        label="App to Org",
        source_type_key="Organization",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="app_to_cap",
        label="App to Capability",
        source_type_key="Application",
        target_type_key="BusinessCapability",
    )

    return {"admin": admin, "viewer": viewer}


class TestAppPortfolio:
    async def test_empty_portfolio(self, client, portfolio_env):
        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(portfolio_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert "fields_schema" in data
        assert "relation_types" in data
        assert "groupable_types" in data
        assert "organizations" in data

    async def test_portfolio_with_apps(self, client, db, portfolio_env):
        admin = portfolio_env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="CRM",
            user_id=admin.id,
            attributes={"costTotalAnnual": 50000},
        )
        await create_card(
            db,
            card_type="Application",
            name="ERP",
            user_id=admin.id,
            attributes={"costTotalAnnual": 100000},
        )

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        names = {item["name"] for item in data["items"]}
        assert names == {"CRM", "ERP"}

    async def test_apps_include_relations(self, client, db, portfolio_env):
        admin = portfolio_env["admin"]
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="Server", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        data = resp.json()
        item = data["items"][0]
        assert len(item["relations"]) == 1
        assert item["relations"][0]["related_name"] == "Server"
        assert item["relations"][0]["related_type"] == "ITComponent"

    async def test_reverse_relation_detected(self, client, db, portfolio_env):
        """Relations where app is the target (not source) are also included."""
        admin = portfolio_env["admin"]
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        org = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
        # Org → App relation (app is target)
        await create_relation(db, type_key="app_to_org", source_id=org.id, target_id=app.id)

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        data = resp.json()
        item = data["items"][0]
        assert len(item["relations"]) == 1
        assert item["relations"][0]["related_name"] == "Sales"

    async def test_org_mapping_from_relations(self, client, db, portfolio_env):
        """Apps should have org_ids based on organization relations."""
        admin = portfolio_env["admin"]
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        org = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
        await create_relation(db, type_key="app_to_org", source_id=org.id, target_id=app.id)

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        data = resp.json()
        item = data["items"][0]
        assert str(org.id) in item["org_ids"]
        assert len(data["organizations"]) == 1
        assert data["organizations"][0]["name"] == "Sales"

    async def test_fields_schema_exposed(self, client, portfolio_env):
        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(portfolio_env["admin"]),
        )
        data = resp.json()
        assert len(data["fields_schema"]) > 0
        field_keys = {
            f["key"] for section in data["fields_schema"] for f in section.get("fields", [])
        }
        assert "costTotalAnnual" in field_keys

    async def test_groupable_types(self, client, db, portfolio_env):
        """Groupable types should include visible related types."""
        admin = portfolio_env["admin"]
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        cap = await create_card(
            db,
            card_type="BusinessCapability",
            name="Sales",
            user_id=admin.id,
        )
        await create_relation(db, type_key="app_to_cap", source_id=app.id, target_id=cap.id)

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert "BusinessCapability" in data["groupable_types"]
        members = data["groupable_types"]["BusinessCapability"]
        assert len(members) == 1
        assert members[0]["name"] == "Sales"

    async def test_relation_types_list(self, client, portfolio_env):
        """Response includes relation type definitions for Application."""
        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(portfolio_env["admin"]),
        )
        data = resp.json()
        rt_keys = {rt["key"] for rt in data["relation_types"]}
        assert "app_to_itc" in rt_keys or "app_to_org" in rt_keys

    async def test_hidden_type_excluded_from_groupable(self, client, db, portfolio_env):
        """Hidden card types should not appear in groupable_types."""
        admin = portfolio_env["admin"]
        await create_card_type(db, key="HiddenType", label="Hidden", is_hidden=True)
        await create_relation_type(
            db,
            key="app_to_hidden",
            label="App to Hidden",
            source_type_key="Application",
            target_type_key="HiddenType",
        )
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        hidden = await create_card(db, card_type="HiddenType", name="Secret", user_id=admin.id)
        await create_relation(
            db,
            type_key="app_to_hidden",
            source_id=app.id,
            target_id=hidden.id,
        )

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert "HiddenType" not in data["groupable_types"]

    async def test_excludes_archived_apps(self, client, db, portfolio_env):
        admin = portfolio_env["admin"]
        await create_card(db, card_type="Application", name="Active", user_id=admin.id)
        await create_card(
            db,
            card_type="Application",
            name="Old",
            user_id=admin.id,
            status="ARCHIVED",
        )

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["name"] == "Active"

    async def test_permission_denied(self, client, portfolio_env):
        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(portfolio_env["viewer"]),
        )
        assert resp.status_code == 403


class TestAppPortfolioTypeParam:
    """The ?type= query param powers the Flexible Portfolio report.

    Defaults to Application for backwards compatibility; any other visible
    card type is accepted; hidden or unknown types return 404.
    """

    async def test_default_type_is_application(self, client, db, portfolio_env):
        admin = portfolio_env["admin"]
        await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        await create_card(db, card_type="BusinessCapability", name="Sales", user_id=admin.id)

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = {item["name"] for item in resp.json()["items"]}
        assert names == {"CRM"}

    async def test_explicit_type_returns_matching_cards(self, client, db, portfolio_env):
        admin = portfolio_env["admin"]
        await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        await create_card(db, card_type="BusinessCapability", name="Sales", user_id=admin.id)
        await create_card(db, card_type="BusinessCapability", name="Marketing", user_id=admin.id)

        resp = await client.get(
            "/api/v1/reports/app-portfolio?type=BusinessCapability",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = {item["name"] for item in data["items"]}
        assert names == {"Sales", "Marketing"}

    async def test_explicit_type_returns_correct_fields_schema(self, client, db, portfolio_env):
        """Fields schema must come from the requested type, not Application."""
        admin = portfolio_env["admin"]
        await create_card_type(
            db,
            key="Initiative",
            label="Initiative",
            fields_schema=[
                {
                    "section": "General",
                    "fields": [
                        {
                            "key": "initiativeStatus",
                            "label": "Status",
                            "type": "single_select",
                            "weight": 1,
                        }
                    ],
                }
            ],
        )

        resp = await client.get(
            "/api/v1/reports/app-portfolio?type=Initiative",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        field_keys = {
            f["key"] for section in data["fields_schema"] for f in section.get("fields", [])
        }
        assert field_keys == {"initiativeStatus"}

    async def test_unknown_type_returns_404(self, client, portfolio_env):
        resp = await client.get(
            "/api/v1/reports/app-portfolio?type=NotARealType",
            headers=auth_headers(portfolio_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_hidden_type_returns_404(self, client, db, portfolio_env):
        await create_card_type(db, key="HiddenKind", label="Hidden", is_hidden=True)
        resp = await client.get(
            "/api/v1/reports/app-portfolio?type=HiddenKind",
            headers=auth_headers(portfolio_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_relation_types_filtered_by_requested_type(self, client, db, portfolio_env):
        """relation_types should list types reachable from the requested type."""
        admin = portfolio_env["admin"]
        # app_to_cap (Application → BusinessCapability) should appear when
        # type=BusinessCapability is requested, with Application as "other".
        await create_card(db, card_type="BusinessCapability", name="Sales", user_id=admin.id)

        resp = await client.get(
            "/api/v1/reports/app-portfolio?type=BusinessCapability",
            headers=auth_headers(admin),
        )
        data = resp.json()
        other_types = {rt["other_type_key"] for rt in data["relation_types"]}
        assert "Application" in other_types


class TestAppPortfolioStakeholders:
    """Stakeholder payload powers the Flexible Portfolio's "group by stakeholder
    role" view and its stakeholder/role filters."""

    async def test_stakeholder_data_in_response(self, client, db, portfolio_env):
        from app.models.stakeholder import Stakeholder

        admin = portfolio_env["admin"]
        alice = await create_user(db, email="alice@test.com", display_name="Alice")
        bob = await create_user(db, email="bob@test.com", display_name="Bob")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )

        app_a = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        app_b = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        # Alice owns both apps, Bob observes ERP.
        db.add_all(
            [
                Stakeholder(card_id=app_a.id, user_id=alice.id, role="responsible"),
                Stakeholder(card_id=app_b.id, user_id=alice.id, role="responsible"),
                Stakeholder(card_id=app_b.id, user_id=bob.id, role="observer"),
            ]
        )
        await db.flush()

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()

        items_by_name = {i["name"]: i for i in data["items"]}
        crm_roles = {s["role"] for s in items_by_name["CRM"]["stakeholders"]}
        erp_roles = {s["role"] for s in items_by_name["ERP"]["stakeholders"]}
        assert crm_roles == {"responsible"}
        assert erp_roles == {"responsible", "observer"}

        role_keys = {r["key"] for r in data["stakeholder_roles"]}
        assert {"responsible", "observer"}.issubset(role_keys)

        user_emails = {u["email"] for u in data["stakeholder_users"]}
        assert user_emails == {"alice@test.com", "bob@test.com"}

    async def test_stakeholder_data_empty_when_no_assignments(self, client, db, portfolio_env):
        """Cards without stakeholders still get stakeholders=[], the user list
        is empty, and the role catalogue is still exposed so the UI can show
        the role filter pre-emptively."""
        admin = portfolio_env["admin"]
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_card(db, card_type="Application", name="CRM", user_id=admin.id)

        resp = await client.get(
            "/api/v1/reports/app-portfolio",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["items"][0]["stakeholders"] == []
        assert data["stakeholder_users"] == []
        assert {r["key"] for r in data["stakeholder_roles"]} == {"responsible"}
