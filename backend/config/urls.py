from django.contrib import admin
from django.urls import path

from apps.accounts import views as accounts
from apps.catalog import public
from apps.catalog.watch import watch
from apps.cookbooks import views as activity

from .views import healthz

activity_routes = [
    path("api/v1/me/video-state/", activity.video_state),
    path("api/v1/videos/<uuid:video_id>/like/", activity.like),
    path("api/v1/cookbooks/", activity.cookbooks),
    path("api/v1/cookbooks/<uuid:cookbook_id>/", activity.cookbook),
    path("api/v1/cookbooks/<uuid:cookbook_id>/items/", activity.add_item),
    path("api/v1/cookbooks/<uuid:cookbook_id>/items/<uuid:video_id>/", activity.remove_item),
    path("api/v1/cookbooks/<uuid:cookbook_id>/reorder/", activity.reorder),
]

urlpatterns = (
    activity_routes
    + [path(str(route.pattern).rstrip("/"), route.callback) for route in activity_routes]
    + [
        path("api/v1/auth/bootstrap/", accounts.bootstrap, name="account_bootstrap"),
        path("api/v1/auth/bootstrap", accounts.bootstrap),
        path("api/v1/me/", accounts.me, name="account_me"),
        path("api/v1/me", accounts.me),
        path("_allauth/browser/v1/config", accounts.config, name="account_config"),
        path("_allauth/browser/v1/auth/signup", accounts.signup, name="account_signup"),
        path("_allauth/browser/v1/auth/login", accounts.login, name="account_login"),
        path("_allauth/browser/v1/auth/session", accounts.session, name="account_session"),
        path(
            "_allauth/browser/v1/account/password/change",
            accounts.password,
            name="account_password",
        ),
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
)
