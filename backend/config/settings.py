"""
Django settings for Air Fryer Recipe Archive backend.
Configured per ARCHITECTURE.md §1, §2, §3.1, §4.1.
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_SECRET_KEY=(str, ""),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    DATABASE_URL=(str, "postgres://postgres:postgres@localhost:5432/airfryer_db"),
    YOUTUBE_API_KEY=(str, ""),
)

# Read .env file from repository root or backend dir
root_env = REPO_ROOT / ".env"
if root_env.exists():
    env.read_env(str(root_env))
backend_env = BASE_DIR / ".env"
if backend_env.exists():
    env.read_env(str(backend_env))

# Security
SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    # Safe fallback ONLY for test environments, strictly prevented in production
    SECRET_KEY = "insecure-dev-fallback-key-replace-in-production-env"

DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

# Application definition
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "allauth",
    "allauth.account",
    "allauth.headless",
    # Project apps
    "apps.accounts",
    "apps.taxonomy",
    "apps.catalog",
    "apps.cookbooks",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "common.middleware.PrivateAdminMiddleware",
    "common.middleware.PublicReadErrorMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Database: PostgreSQL required by ARCHITECTURE §1 (no SQLite fallback)
DATABASES = {"default": env.db("DATABASE_URL")}

# Custom User Model (ARCHITECTURE §3.1)
AUTH_USER_MODEL = "accounts.User"

COOKBOOK_OWNER_LIMIT = env.int("COOKBOOK_OWNER_LIMIT", default=10)
COOKBOOK_ITEM_LIMIT = env.int("COOKBOOK_ITEM_LIMIT", default=200)

# Browser-only accounts; urls.py explicitly registers the supported operations.
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]
ACCOUNT_ADAPTER = "apps.accounts.adapters.AccountAdapter"
HEADLESS_ADAPTER = "apps.accounts.adapters.HeadlessAdapter"
HEADLESS_ONLY = True
HEADLESS_CLIENTS = ("browser",)
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*"]
ACCOUNT_EMAIL_VERIFICATION = "none"
ACCOUNT_EMAIL_NOTIFICATIONS = False
ACCOUNT_LOGIN_BY_CODE_ENABLED = False
ACCOUNT_LOGOUT_ON_PASSWORD_CHANGE = False
ACCOUNT_RATE_LIMITS = {
    "signup": "20/m/ip",
    "login": "30/m/ip",
    "login_failed": "10/m/ip,5/5m/key",
    "change_password": "5/m/user",
    "delete_account": "5/m/user",
    "admin_login": "30/m/ip,5/5m/key",
}
# Local limits use Django's process-local cache. Shared-worker/proxy validation
# stays in Phase 9; this phase introduces no cache server.
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_FAILURE_VIEW = "apps.accounts.views.csrf_failure"

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Django REST Framework base configuration (ARCHITECTURE §5)
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",  # Deny-by-default
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    "UNAUTHENTICATED_USER": None,
}

# YouTube Data API Key
YOUTUBE_API_KEY = env("YOUTUBE_API_KEY")

# Explicitly opt into the Vite development server; built mode uses its manifest.
VITE_DEV_SERVER = env("VITE_DEV_SERVER", default="")
VITE_MANIFEST_PATH = Path(
    env("VITE_MANIFEST_PATH", default=str(REPO_ROOT / "frontend/dist/.vite/manifest.json"))
)
