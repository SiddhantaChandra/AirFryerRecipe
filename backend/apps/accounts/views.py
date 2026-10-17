"""Small browser-only surface around allauth; public catalog handlers stay separate."""

import json

from allauth.account.adapter import get_adapter
from allauth.core import ratelimit
from allauth.headless.account import inputs, views
from allauth.headless.base.views import ConfigView
from allauth.headless.constants import Client
from django import forms
from django.contrib.auth import logout
from django.contrib.auth.password_validation import validate_password
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token, rotate_token
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_GET, require_http_methods

from .models import User


def user_data(user):
    return {
        "id": str(user.pk),
        "email": user.email,
        "name": user.name,
        "theme_preference": user.theme_preference,
    }


def error(message, status=400):
    return JsonResponse({"detail": message}, status=status)


def csrf_failure(request, reason=""):
    return error("Security check failed. Refresh the page and try again.", 403)


def read_json(request):
    if request.content_type != "application/json":
        raise ValueError("Send a JSON object.")
    if int(request.META.get("CONTENT_LENGTH") or 0) > 16384 or len(request.body) > 16384:
        raise ValueError("Account request is too large.")
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, UnicodeDecodeError):
        raise ValueError("Send a valid JSON object.") from None
    if not isinstance(data, dict):
        raise ValueError("Send a JSON object.")
    return data


def revoke_sessions(user_id, keep=None):
    """Small local archive: inspect database sessions, without a tracking dependency."""
    keys = []
    # Include expired rows: deletion must remove associated auth data too.
    for session in Session.objects.exclude(session_key=keep):
        if session.get_decoded().get("_auth_user_id") == str(user_id):
            keys.append(session.session_key)
    Session.objects.filter(session_key__in=keys).delete()


class SignupInput(inputs.SignupInput):
    password = forms.CharField(strip=False, max_length=4096)
    password_confirm = forms.CharField(strip=False, max_length=4096)

    def clean(self):
        data = super().clean()
        if data.get("password") != data.get("password_confirm"):
            self.add_error("password_confirm", "Passwords must match.")
        if data.get("password") and data.get("email"):
            try:
                validate_password(data["password"], User(email=data["email"]))
            except ValidationError as exc:
                self.add_error("password", exc)
        return data


class LoginInput(inputs.LoginInput):
    password = forms.CharField(strip=False, max_length=4096)

    def clean(self):
        data = super().clean()
        login = getattr(self, "login", None)
        if login and not login.user.is_active:
            self.add_error("password", get_adapter().validation_error("email_password_mismatch"))
        return data


class ChangePasswordInput(inputs.ChangePasswordInput):
    current_password = forms.CharField(strip=False, max_length=4096)
    new_password = forms.CharField(strip=False, max_length=4096)
    new_password_confirm = forms.CharField(strip=False, max_length=4096)

    def clean_current_password(self):
        password = self.cleaned_data.get("current_password")
        if not password or not self.user.check_password(password):
            raise get_adapter().validation_error("enter_current_password")
        return password

    def clean(self):
        data = super().clean()
        if data.get("new_password") != data.get("new_password_confirm"):
            self.add_error("new_password_confirm", "Passwords must match.")
        return data


class StrictInputMixin:
    allowed_fields = frozenset()

    def handle(self, request, *args, **kwargs):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            try:
                data = read_json(request)
            except ValueError as exc:
                return error(str(exc))
            unknown = set(data) - self.allowed_fields
            if unknown:
                return error("Unsupported account fields.")
            if "email" in data:
                if not isinstance(data["email"], str) or len(data["email"]) > 254:
                    return error("Enter an email address of at most 254 characters.")
                data["email"] = User.objects.normalize_email(data["email"])
                # allauth parses the same validated body in RESTView.handle().
                request._body = json.dumps(data).encode()
        return super().handle(request, *args, **kwargs)


class SignupView(StrictInputMixin, views.SignupView):
    allowed_fields = {"email", "password", "password_confirm"}
    input_class = {"POST": SignupInput}

    def post(self, request, *args, **kwargs):
        try:
            with transaction.atomic():
                return super().post(request, *args, **kwargs)
        except IntegrityError:
            # Concurrent signups must not leave partial EmailAddress/User rows.
            if User.objects.filter(email__iexact=self.input.cleaned_data["email"]).exists():
                return JsonResponse({"email": ["An account already uses this email."]}, status=400)
            raise


class LoginView(StrictInputMixin, views.LoginView):
    allowed_fields = {"email", "password"}
    input_class = LoginInput

    def handle_invalid_input(self, input):
        response = super().handle_invalid_input(input)
        if any(
            err.code == "too_many_login_attempts"
            for errors in input.errors.as_data().values()
            for err in errors
        ):
            response.status_code = 429
            payload = json.loads(response.content)
            payload["status"] = 429
            response.content = json.dumps(payload)
            response["Retry-After"] = "300"
        return response


class SessionView(StrictInputMixin, views.SessionView):
    def delete(self, request, *args, **kwargs):
        response = super().delete(request, *args, **kwargs)
        rotate_token(request)
        return response


class PasswordView(StrictInputMixin, views.ChangePasswordView):
    allowed_fields = {"current_password", "new_password", "new_password_confirm"}
    input_class = ChangePasswordInput

    def handle(self, request, *args, **kwargs):
        with transaction.atomic():
            user = (
                User.objects.select_for_update().filter(pk=request.user.pk, is_active=True).first()
            )
            if user is None:
                return error("Please log in again.", 401)
            request.user = user
            return super().handle(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        revoke_sessions(request.user.pk, keep=request.session.session_key)
        return response


@require_GET
def bootstrap(request):
    return JsonResponse({"csrf_token": get_token(request)})


@sensitive_post_parameters()
@require_http_methods(["GET", "PATCH", "DELETE"])
def me(request):
    if not request.user.is_authenticated or not request.user.is_active:
        return error("Please log in again.", 401)
    if request.method == "GET":
        return JsonResponse(user_data(request.user))
    try:
        data = read_json(request)
    except ValueError as exc:
        return error(str(exc))
    with transaction.atomic():
        user = User.objects.select_for_update().filter(pk=request.user.pk, is_active=True).first()
        if user is None:
            return error("Please log in again.", 401)
        if request.method == "PATCH":
            if set(data) - {"name", "theme_preference"}:
                return error("Only name and theme_preference can be changed.")
            errors = {}
            if "name" in data and (not isinstance(data["name"], str) or len(data["name"]) > 150):
                errors["name"] = ["Enter a name of at most 150 characters."]
            if "theme_preference" in data and data["theme_preference"] not in (
                "light",
                "dark",
                "system",
            ):
                errors["theme_preference"] = ["Choose Light, Dark or System."]
            if errors:
                return JsonResponse(errors, status=400)
            for key, value in data.items():
                setattr(user, key, value)
            if data:
                user.save(update_fields=list(data))
            return JsonResponse(user_data(user))
        if set(data) != {"password"} or not isinstance(data.get("password"), str):
            return error("Confirm using your current password.")
        if not ratelimit.consume(request, action="delete_account", user=user):
            response = error("Too many attempts. Please retry in a minute.", 429)
            response["Retry-After"] = "60"
            return response
        if len(data["password"]) > 4096 or not user.check_password(data["password"]):
            return JsonResponse({"password": ["Enter your current password."]}, status=400)
        revoke_sessions(user.pk)
        user.delete()
        logout(request)
        rotate_token(request)
    return HttpResponse(status=204)


# Do not include allauth.urls or allauth.headless.urls: those also expose excluded flows.
config = ConfigView.as_api_view(client=Client.BROWSER)
signup = sensitive_post_parameters()(SignupView.as_api_view(client=Client.BROWSER))
login = sensitive_post_parameters()(LoginView.as_api_view(client=Client.BROWSER))
session = sensitive_post_parameters()(SessionView.as_api_view(client=Client.BROWSER))
password = sensitive_post_parameters()(PasswordView.as_api_view(client=Client.BROWSER))
