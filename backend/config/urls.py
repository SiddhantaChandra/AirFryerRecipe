from django.contrib import admin
from django.urls import path

from apps.catalog import public
from apps.catalog.watch import watch

from .views import healthz

urlpatterns = [
    path("shorts/<str:slug>", watch, name="watch"),
    path("shorts/<str:slug>/", watch, name="watch_slash"),
    # Django Admin moved off /admin to avoid colliding with React SPA route
    path("django-admin/", admin.site.urls),
    # Unauthenticated healthcheck
    path("healthz", healthz, name="healthz_no_slash"),
    path("healthz/", healthz, name="healthz"),
    # Versioned API routes prefix (ARCHITECTURE §5)
    path("api/v1/videos/", public.feed, name="public_feed"),
    path("api/v1/filters/", public.filters, name="public_filters"),
    path("api/v1/videos/<str:slug>/", public.detail, name="public_detail"),
    path("api/v1/videos/<str:slug>/neighbors/", public.neighbors, name="public_neighbors"),
]
