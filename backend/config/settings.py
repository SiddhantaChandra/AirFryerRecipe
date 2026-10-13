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
    # Project apps
    "apps.accounts",
    "apps.taxonomy",
    "apps.catalog",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "common.middleware.PrivateAdminMiddleware",
    "common.middleware.PublicReadErrorMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
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
