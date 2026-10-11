from django.contrib import admin
from django.urls import include, path

from .views import healthz

urlpatterns = [
    # Django Admin moved off /admin to avoid colliding with React SPA route
    path("django-admin/", admin.site.urls),
    # Unauthenticated healthcheck
    path("healthz", healthz, name="healthz_no_slash"),
    path("healthz/", healthz, name="healthz"),
    # Versioned API routes prefix (ARCHITECTURE §5)
    path("api/v1/", include([])),
]
