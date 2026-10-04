import os
from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent.parent

env = environ.Env()
# Read repo-root .env if it exists
root_env_file = REPO_ROOT / ".env"
if root_env_file.exists():
    env.read_env(str(root_env_file))

SECRET_KEY = env("DJANGO_SECRET_KEY", default="spike-insecure-secret-key-1234567890")
DEBUG = env.bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "corsheaders",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "spike_project.urls"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# CORS settings for Vite dev server on localhost:5173
CORS_ALLOW_ALL_ORIGINS = True

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "UNAUTHENTICATED_USER": None,
}

YOUTUBE_API_KEY = env("YOUTUBE_API_KEY", default="")
