from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

import pytest
from allauth.account.models import EmailAddress, EmailConfirmation
from django.contrib.admin.models import LogEntry
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.db import IntegrityError, close_old_connections, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import Client
from django.utils import timezone

from apps.accounts.views import revoke_sessions
from apps.catalog.models import Video

User = get_user_model()
AUTH = "/_allauth/browser/v1/"
PASSWORD = "Phase5-QA-strong-pass-804!"


@pytest.fixture(autouse=True)
def account_limits():
    cache.clear()
    yield
    cache.clear()


def browser():
    client = Client(enforce_csrf_checks=True)
    token = client.get("/api/v1/auth/bootstrap/").json()["csrf_token"]
    return client, token


def post(client, path, data, token):
    return client.post(path, data, content_type="application/json", HTTP_X_CSRFTOKEN=token)


def login(client, email, password=PASSWORD):
    token = client.get("/api/v1/auth/bootstrap/").json()["csrf_token"]
    response = post(client, AUTH + "auth/login", {"email": email, "password": password}, token)
    assert response.status_code == 200, response.content
    return client.get("/api/v1/auth/bootstrap/").json()["csrf_token"]


def private(response):
    assert "private" in response["Cache-Control"]
    assert "no-store" in response["Cache-Control"]
    assert response["X-Robots-Tag"] == "noindex, nofollow"


@pytest.mark.django_db
def test_signup_session_settings_logout_no_email():
    client, token = browser()
    with patch("django.core.mail.EmailMessage.send", side_effect=AssertionError("No delivery")):
        response = post(
            client,
            AUTH + "auth/signup",
            {
                "email": "  Chef@Example.INVALID ",
                "password": PASSWORD,
                "password_confirm": PASSWORD,
            },
            token,
        )
        assert response.status_code == 200, response.content
        private(response)
        user = User.objects.get(email="chef@example.invalid")
        assert not user.is_staff and not user.is_superuser
        address = EmailAddress.objects.get(user=user)
        assert address.primary and not address.verified
        assert set(client.get("/api/v1/me/").json()) == {"id", "email", "name", "theme_preference"}
        old_token = token
        token = client.get("/api/v1/auth/bootstrap/").json()["csrf_token"]
        assert (
            client.patch(
                "/api/v1/me/",
                {"name": "Chef", "theme_preference": "dark"},
                content_type="application/json",
                HTTP_X_CSRFTOKEN=old_token,
            ).status_code
            == 403
        )
        response = client.patch(
            "/api/v1/me/",
            {"name": "रसोइया রাঁধুনি", "theme_preference": "dark"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        assert response.status_code == 200
        assert response.json()["theme_preference"] == "dark"
        assert (
            client.delete(
                AUTH + "auth/session", {}, content_type="application/json", HTTP_X_CSRFTOKEN=token
            ).status_code
            == 401
        )
        private(client.get("/api/v1/me/"))
        assert client.get("/api/v1/me/").status_code == 401
        assert (
            post(
                client, AUTH + "auth/login", {"email": user.email, "password": PASSWORD}, token
            ).status_code
            == 403
        )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "operation", ["auth/signup", "auth/login", "auth/session", "account/password/change"]
)
def test_anonymous_mutations_require_csrf(operation):
    client = Client(enforce_csrf_checks=True)
    response = client.post(AUTH + operation, {}, content_type="application/json")
    assert response.status_code == 403
    private(response)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "header,value",
    [("HTTP_ORIGIN", "https://hostile.invalid"), ("HTTP_REFERER", "https://hostile.invalid/x")],
)
def test_hostile_origin_and_https_referer(header, value):
    client, token = browser()
    response = client.post(
        AUTH + "auth/login",
        {},
        content_type="application/json",
        secure=True,
        HTTP_X_CSRFTOKEN=token,
        **{header: value},
    )
    assert response.status_code == 403
    private(response)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "auth/password/request",
        "auth/password/reset",
        "auth/email/verify",
        "auth/email/verify/resend",
        "account/email",
        "auth/code/request",
        "auth/reauthenticate",
        "auth/phone/verify",
    ],
)
def test_excluded_headless_operations_cannot_mutate_or_send(path):
    client, token = browser()
    with patch("django.core.mail.EmailMessage.send", side_effect=AssertionError("No delivery")):
        response = post(client, AUTH + path, {"email": "qa@example.invalid"}, token)
    assert response.status_code == 404
    private(response)
    assert not User.objects.exists()
    assert not EmailConfirmation.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "/accounts/password/reset/",
        "/accounts/email/",
        "/_allauth/app/v1/auth/signup",
        "/_allauth/app/v1/tokens/refresh",
        "/_allauth/browser/v1/auth/signup/",
        "/accounts/login/",
    ],
)
def test_unused_route_families_are_private_404(path):
    response = Client().get(path)
    assert response.status_code == 404
    private(response)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "field",
    [
        "is_staff",
        "is_superuser",
        "is_active",
        "groups",
        "user_permissions",
        "id",
        "verified",
        "email_verified",
    ],
)
def test_signup_rejects_privilege_and_verification_injection(field):
    client, token = browser()
    response = post(
        client,
        AUTH + "auth/signup",
        {
            "email": "qa@example.invalid",
            "password": PASSWORD,
            "password_confirm": PASSWORD,
            field: True,
        },
        token,
    )
    assert response.status_code == 400
    assert not User.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "password,confirmation",
    [
        ("12345678", "12345678"),
        ("short", "short"),
        (PASSWORD, "mismatch"),
        ("chef@example.invalid", "chef@example.invalid"),
    ],
)
def test_signup_password_validation(password, confirmation):
    client, token = browser()
    response = post(
        client,
        AUTH + "auth/signup",
        {
            "email": "chef@example.invalid",
            "password": password,
            "password_confirm": confirmation,
        },
        token,
    )
    assert response.status_code == 400, response.content
    assert not User.objects.exists()


@pytest.mark.django_db
def test_existing_staff_case_insensitive_login_and_inactive_denial():
    user = User.objects.create_superuser("Trusted@Example.INVALID", PASSWORD)
    client, _ = browser()
    login(client, " TRUSTED@example.invalid ")
    user.refresh_from_db()
    assert user.is_staff and user.is_superuser
    user.is_active = False
    user.save(update_fields=["is_active"])
    assert client.get("/api/v1/me/").status_code == 401
    other, token = browser()
    response = post(other, AUTH + "auth/login", {"email": user.email, "password": PASSWORD}, token)
    assert response.status_code in {400, 401, 403}
    assert other.get("/api/v1/me/").status_code == 401


@pytest.mark.django_db
def test_database_identity_and_duplicate_signup():
    User.objects.create_user("chef@example.invalid", PASSWORD)
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create(email="  CHEF@EXAMPLE.INVALID ")
    client, token = browser()
    response = post(
        client,
        AUTH + "auth/signup",
        {
            "email": "CHEF@example.invalid",
            "password": PASSWORD,
            "password_confirm": PASSWORD,
        },
        token,
    )
    assert response.status_code == 400, response.content
    assert User.objects.count() == 1


@pytest.mark.django_db
def test_password_change_revokes_other_sessions_and_never_sends_mail():
    user = User.objects.create_user("chef@example.invalid", PASSWORD)
    first, _ = browser()
    second, _ = browser()
    token = login(first, user.email)
    login(second, user.email)
    old_key = second.session.session_key
    data = {
        "current_password": PASSWORD,
        "new_password": PASSWORD + "new",
        "new_password_confirm": PASSWORD + "new",
    }
    with patch("django.core.mail.EmailMessage.send", side_effect=AssertionError("No delivery")):
        response = post(first, AUTH + "account/password/change", data, token)
    assert response.status_code == 200, response.content
    assert first.get("/api/v1/me/").status_code == 200
    assert second.get("/api/v1/me/").status_code == 401
    assert not Session.objects.filter(session_key=old_key).exists()
    user.refresh_from_db()
    assert not user.check_password(PASSWORD) and user.check_password(PASSWORD + "new")


@pytest.mark.django_db
def test_settings_allowlist_and_password_failure_preserve_account():
    user = User.objects.create_user("chef@example.invalid", PASSWORD)
    client, _ = browser()
    token = login(client, user.email)
    for data in [
        {"email": "other@example.invalid"},
        {"id": str(user.pk)},
        {"is_staff": True},
        {"name": "x" * 151},
        {"theme_preference": "invalid"},
        {"name": None},
    ]:
        response = client.patch(
            "/api/v1/me/", data, content_type="application/json", HTTP_X_CSRFTOKEN=token
        )
        assert response.status_code == 400
        private(response)
    for password in ["wrong", ""]:
        response = client.delete(
            "/api/v1/me/",
            {"password": password},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        assert response.status_code == 400
    assert (
        client.delete(
            "/api/v1/me/", {"password": PASSWORD}, content_type="application/json"
        ).status_code
        == 403
    )
    response = post(
        client,
        AUTH + "account/password/change",
        {
            "current_password": "wrong",
            "new_password": PASSWORD + "new",
            "new_password_confirm": PASSWORD + "new",
        },
        token,
    )
    assert response.status_code == 400
    user.refresh_from_db()
    assert user.check_password(PASSWORD)
    assert client.get("/api/v1/me/").status_code == 200


@pytest.mark.django_db
def test_confirmed_deletion_all_sessions_auth_cleanup_and_catalog_survival():
    user = User.objects.create_superuser("qa@example.invalid", PASSWORD)
    EmailAddress.objects.create(user=user, email=user.email, primary=True, verified=False)
    video = Video.objects.create(
        external_id="QAphase5001",
        canonical_url="https://www.youtube.com/watch?v=QAphase5001",
        recipe_name="QA recipe",
        added_by=user,
        reviewed_by=user,
    )
    LogEntry.objects.create(
        user=user,
        content_type=ContentType.objects.get_for_model(Video),
        object_id=str(video.pk),
        object_repr="QA recipe",
        action_flag=1,
        change_message="QA creation",
    )
    first, _ = browser()
    second, _ = browser()
    token = login(first, user.email)
    login(second, user.email)
    Session.objects.create(
        session_key="qa-expired-auth-row",
        session_data=SessionStore().encode({"_auth_user_id": str(user.pk)}),
        expire_date=timezone.now() - timedelta(days=1),
    )
    response = first.delete(
        "/api/v1/me/",
        {"password": PASSWORD},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 204
    private(response)
    assert not User.objects.filter(pk=user.pk).exists()
    assert (
        not EmailAddress.objects.exists() and not LogEntry.objects.filter(user_id=user.pk).exists()
    )
    assert not Session.objects.exists()
    assert second.get("/api/v1/me/").status_code == 401
    assert first.get("/api/v1/me/").status_code == 401
    video.refresh_from_db()
    assert video.added_by is None and video.reviewed_by is None


@pytest.mark.django_db
def test_deletion_rollback_keeps_account_auth_and_sessions():
    user = User.objects.create_user("qa@example.invalid", PASSWORD)
    client, _ = browser()
    token = login(client, user.email)
    key = client.session.session_key
    client.raise_request_exception = False
    with patch.object(User, "delete", side_effect=RuntimeError("QA transaction failure")):
        response = client.delete(
            "/api/v1/me/",
            {"password": PASSWORD},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
    assert response.status_code == 500
    private(response)
    assert (
        User.objects.filter(pk=user.pk).exists()
        and Session.objects.filter(session_key=key).exists()
    )
    assert client.get("/api/v1/me/").status_code == 200


@pytest.mark.django_db
def test_local_rate_limits_and_sensitive_logs(caplog):
    user = User.objects.create_user("qa@example.invalid", PASSWORD)
    client, _ = browser()
    token = login(client, user.email)
    for _ in range(5):
        assert (
            client.delete(
                "/api/v1/me/",
                {"password": "wrong"},
                content_type="application/json",
                HTTP_X_CSRFTOKEN=token,
            ).status_code
            == 400
        )
    response = client.delete(
        "/api/v1/me/",
        {"password": "wrong"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 429 and response["Retry-After"] == "60"
    cache.clear()
    with patch("allauth.core.ratelimit.consume", return_value=False):
        admin = client.post("/django-admin/login/", {"username": user.email, "password": PASSWORD})
        assert admin.status_code == 429
    assert user.email not in caplog.text and PASSWORD not in caplog.text


@pytest.mark.django_db(transaction=True)
def test_concurrent_case_variant_signups_are_atomic():
    def attempt(email):
        close_old_connections()
        try:
            client, token = browser()
            return post(
                client,
                AUTH + "auth/signup",
                {
                    "email": email,
                    "password": PASSWORD,
                    "password_confirm": PASSWORD,
                },
                token,
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(attempt, ["Race@example.invalid", "race@EXAMPLE.INVALID"]))
    assert sorted(statuses) == [200, 400]
    assert User.objects.count() == 1 and EmailAddress.objects.count() == 1


@pytest.mark.django_db
def test_revocation_does_not_remove_another_users_session():
    first = User.objects.create_user("first@example.invalid", PASSWORD)
    second = User.objects.create_user("second@example.invalid", PASSWORD)
    a, _ = browser()
    b, _ = browser()
    login(a, first.email)
    login(b, second.email)
    revoke_sessions(first.pk)
    assert a.get("/api/v1/me/").status_code == 401
    assert b.get("/api/v1/me/").status_code == 200


@pytest.mark.django_db(transaction=True)
def test_existing_database_migration_preserves_staff_and_refuses_collisions():
    old, new = [("accounts", "0001_initial")], [("accounts", "0002_email_identity")]
    executor = MigrationExecutor(connection)
    executor.migrate(old)
    LegacyUser = executor.loader.project_state(old).apps.get_model("accounts", "User")
    first = LegacyUser.objects.create(
        email=" QA@Example.INVALID ", password="retained-hash", is_staff=True, is_superuser=True
    )
    duplicate = LegacyUser.objects.create(email="qa@example.invalid")
    try:
        with pytest.raises(RuntimeError, match="owner resolution"):
            MigrationExecutor(connection).migrate(new)
        first.refresh_from_db()
        assert first.email == " QA@Example.INVALID "
        duplicate.delete()
        MigrationExecutor(connection).migrate(new)
        first.refresh_from_db()
        assert first.email == "qa@example.invalid"
        assert first.password == "retained-hash" and first.is_staff and first.is_superuser
        with pytest.raises(IntegrityError), transaction.atomic():
            LegacyUser.objects.create(email="QA@example.invalid")
    finally:
        LegacyUser.objects.exclude(pk=first.pk).delete()
        MigrationExecutor(connection).migrate(new)


@pytest.mark.django_db(transaction=True)
def test_competing_deletion_requests_revoke_every_session_once():
    user = User.objects.create_user("delete-race@example.invalid", PASSWORD)
    browsers = [browser(), browser()]
    tokens = [login(client, user.email) for client, _ in browsers]
    barrier = Barrier(2)

    def attempt(item):
        client, token = item
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return client.delete(
                "/api/v1/me/",
                {"password": PASSWORD},
                content_type="application/json",
                HTTP_X_CSRFTOKEN=token,
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(attempt, zip([item[0] for item in browsers], tokens, strict=True)))
    assert sorted(statuses) == [204, 401]
    assert not User.objects.exists() and not Session.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize("operation,attempts", [("signup", 21), ("login", 31), ("password", 6)])
def test_effective_auth_limits_return_retry_feedback(operation, attempts):
    user = User.objects.create_user("limit@example.invalid", PASSWORD)
    client, token = browser()
    if operation == "password":
        token = login(client, user.email)
    path = AUTH + ("account/password/change" if operation == "password" else "auth/" + operation)
    statuses = []
    for _ in range(attempts):
        if operation == "signup":
            data = {
                "email": "new@example.invalid",
                "password": "short",
                "password_confirm": "short",
            }
        elif operation == "password":
            data = {
                "current_password": "wrong",
                "new_password": PASSWORD,
                "new_password_confirm": PASSWORD,
            }
        else:
            data = {"email": user.email, "password": "wrong"}
        response = post(client, path, data, token)
        statuses.append(response.status_code)
        if response.status_code == 429:
            private(response)
            assert response.has_header("Retry-After")
            break
    assert 429 in statuses
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


@pytest.mark.django_db
def test_account_aliases_cookie_flags_and_bad_inputs():
    client, token = browser()
    assert client.cookies["csrftoken"]["httponly"]
    assert client.cookies["csrftoken"]["samesite"] == "Lax"
    user = User.objects.create_user("qa@example.invalid", PASSWORD)
    token = login(client, user.email)
    assert client.cookies["sessionid"]["httponly"]
    assert client.cookies["sessionid"]["samesite"] == "Lax"
    for url in ["/api/v1/me", "/api/v1/me/", "/api/v1/auth/bootstrap", "/api/v1/auth/bootstrap/"]:
        response = client.get(url)
        assert response.status_code == 200
        private(response)
    response = client.patch(
        "/api/v1/me", {"name": "QA"}, content_type="application/json", HTTP_X_CSRFTOKEN=token
    )
    assert response.status_code == 200
    for body in ["[1]", '"string"', "{invalid", '{"name":' + '"' + "x" * 17000 + '"}']:
        response = client.patch(
            "/api/v1/me/", body, content_type="application/json", HTTP_X_CSRFTOKEN=token
        )
        assert response.status_code == 400
        private(response)
