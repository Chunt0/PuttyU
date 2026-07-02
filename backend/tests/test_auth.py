"""M0.1 auth: setup -> login -> logout, plus the hardening (ADR-0001)."""

from fastapi.testclient import TestClient

from app import app

CSRF = {"X-PuttyU-CSRF": "1"}
OWNER = {"username": "owner", "password": "correct-horse-battery"}


def client() -> TestClient:
    return TestClient(app, headers=CSRF)


def test_me_reports_needs_setup_on_fresh_box():
    with client() as c:
        assert c.get("/api/auth/me").status_code == 409


def test_setup_login_logout_flow():
    with client() as c:
        assert c.post("/api/auth/setup", json=OWNER).status_code == 200
        # setup closes after the owner exists
        assert c.post("/api/auth/setup", json=OWNER).status_code == 409
        # created but not logged in
        assert c.get("/api/auth/me").status_code == 401

        wrong = {"username": "owner", "password": "wrong-password-123"}
        assert c.post("/api/auth/login", json=wrong).status_code == 401

        r = c.post("/api/auth/login", json=OWNER)
        assert r.status_code == 200
        assert r.json()["username"] == "owner"

        me = c.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["username"] == "owner"

        assert c.post("/api/auth/logout").status_code == 200
        assert c.get("/api/auth/me").status_code == 401


def test_mutations_require_csrf_header():
    with TestClient(app) as c:  # deliberately no CSRF header
        r = c.post("/api/auth/setup", json=OWNER)
        assert r.status_code == 403
        assert r.json()["detail"] == "missing_csrf_header"


def test_login_rate_limited_after_repeated_failures():
    with client() as c:
        assert c.post("/api/auth/setup", json=OWNER).status_code == 200
        wrong = {"username": "owner", "password": "wrong-password-123"}
        for _ in range(5):
            assert c.post("/api/auth/login", json=wrong).status_code == 401
        # 6th attempt is blocked even with the right password
        assert c.post("/api/auth/login", json=OWNER).status_code == 429


def test_tampered_cookie_is_rejected():
    with client() as c:
        assert c.post("/api/auth/setup", json=OWNER).status_code == 200
        assert c.post("/api/auth/login", json=OWNER).status_code == 200
        c.cookies.set("puttyu_session", "forged-session-id.deadbeef")
        assert c.get("/api/auth/me").status_code == 401


def test_password_minimum_length_enforced():
    with client() as c:
        r = c.post(
            "/api/auth/setup", json={"username": "owner", "password": "short"}
        )
        assert r.status_code == 422
