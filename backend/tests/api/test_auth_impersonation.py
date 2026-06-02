"""Tests for the role-impersonation auth endpoints.

Covers:
- POST /auth/impersonate requires admin.impersonate
- /auth/me reflects the impersonated role's permissions
- Mutating endpoints honour the impersonated role (an admin impersonating
  viewer cannot create cards)
- POST /auth/stop-impersonating issues a token without the claim and
  restores the admin's original powers
- Events emitted during an impersonated request carry impersonator_user_id
  and impersonated_role in their data payload
"""

from __future__ import annotations

from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.core.security import create_access_token, decode_access_token
from app.models.event import Event
from tests.conftest import auth_headers, create_role, create_user


def _impersonating_headers(user, role: str) -> dict[str, str]:
    token = create_access_token(user.id, user.role, impersonated_role=role)
    return {"Authorization": f"Bearer {token}"}


class TestImpersonateEndpoint:
    async def test_admin_can_start_impersonation(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.post(
            "/api/v1/auth/impersonate",
            headers=auth_headers(admin),
            json={"role": "member"},
        )
        assert resp.status_code == 200, resp.text
        token = resp.json()["access_token"]
        payload = decode_access_token(token)
        assert payload["sub"] == str(admin.id)
        assert payload["role"] == "admin"  # real role unchanged
        assert payload["impersonated_role"] == "member"

    async def test_member_cannot_impersonate(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        member = await create_user(db, email="member@test.com", role="member")

        resp = await client.post(
            "/api/v1/auth/impersonate",
            headers=auth_headers(member),
            json={"role": "admin"},
        )
        assert resp.status_code == 403

    async def test_unknown_role_rejected(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.post(
            "/api/v1/auth/impersonate",
            headers=auth_headers(admin),
            json={"role": "ghost"},
        )
        assert resp.status_code == 404

    async def test_cannot_impersonate_admin_role(self, client, db):
        # Even if a "support" role with admin.impersonate exists, it must
        # not be able to step up to the admin wildcard.
        await create_role(db, key="admin", permissions={"*": True})
        support_perms = {**MEMBER_PERMISSIONS, "admin.impersonate": True}
        await create_role(db, key="support", permissions=support_perms)
        support_user = await create_user(db, email="support@test.com", role="support")

        resp = await client.post(
            "/api/v1/auth/impersonate",
            headers=auth_headers(support_user),
            json={"role": "admin"},
        )
        assert resp.status_code == 400

    async def test_impersonating_own_role_rejected(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.post(
            "/api/v1/auth/impersonate",
            headers=auth_headers(admin),
            json={"role": "admin"},
        )
        # 400 — the "cannot impersonate admin" branch fires first.
        assert resp.status_code == 400


class TestMeUnderImpersonation:
    async def test_me_returns_impersonated_permissions(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get(
            "/api/v1/auth/me",
            headers=_impersonating_headers(admin, "viewer"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "viewer"
        assert data["impersonated_role"] == "viewer"
        assert data["impersonated_role_label"] is not None
        # viewer perms — no wildcard, no admin.*
        perms = data["permissions"]
        assert perms.get("*") is not True
        assert perms.get("admin.users") is not True
        assert perms.get("inventory.view") is True


class TestImpersonationEnforcement:
    async def test_admin_impersonating_viewer_cannot_create_card(self, client, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        admin = await create_user(db, email="admin@test.com", role="admin")

        # Sanity check: same admin can create a card without impersonation.
        ok = await client.post(
            "/api/v1/cards",
            headers=auth_headers(admin),
            json={"type": "Application", "name": "Sanity"},
        )
        assert ok.status_code == 201, ok.text

        # Now impersonating viewer — viewer lacks inventory.create.
        denied = await client.post(
            "/api/v1/cards",
            headers=_impersonating_headers(admin, "viewer"),
            json={"type": "Application", "name": "Blocked"},
        )
        assert denied.status_code == 403


class TestStopImpersonating:
    async def test_stop_returns_token_without_claim(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.post(
            "/api/v1/auth/stop-impersonating",
            headers=_impersonating_headers(admin, "member"),
        )
        assert resp.status_code == 200
        token = resp.json()["access_token"]
        payload = decode_access_token(token)
        assert payload.get("impersonated_role") is None
        assert payload["role"] == "admin"

    async def test_stop_when_no_impersonation_returns_400(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.post(
            "/api/v1/auth/stop-impersonating",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


class TestImpersonationAuditStamp:
    async def test_event_carries_impersonator_metadata(self, client, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        admin = await create_user(db, email="admin@test.com", role="admin")

        # Member can create cards; admin impersonating member is allowed.
        resp = await client.post(
            "/api/v1/cards",
            headers=_impersonating_headers(admin, "member"),
            json={"type": "Application", "name": "Audited"},
        )
        assert resp.status_code == 201, resp.text

        # Look up the card.created event for this card.
        card_id = resp.json()["id"]
        ev_result = await db.execute(
            select(Event).where(Event.card_id == card_id, Event.event_type == "card.created")
        )
        event = ev_result.scalar_one_or_none()
        assert event is not None
        assert event.data is not None
        assert event.data.get("impersonator_user_id") == str(admin.id)
        assert event.data.get("impersonated_role") == "member"
