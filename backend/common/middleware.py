from django.utils.cache import patch_cache_control


class PrivateAdminMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            request.path.startswith(
                (
                    "/django-admin",
                    "/_allauth",
                    "/accounts",
                    "/api/v1/me/",
                    "/api/v1/cookbooks",
                    "/cookbooks",
                )
            )
            or (
                request.path.startswith("/api/v1/videos/")
                and request.path.rstrip("/").endswith("/like")
            )
            or request.path.rstrip("/")
            in {
                "/api/v1/me",
                "/api/v1/auth/bootstrap",
                "/login",
                "/signup",
                "/settings",
            }
        ):
            patch_cache_control(response, private=True, no_store=True, no_cache=True, max_age=0)
            response["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response["X-Robots-Tag"] = "noindex, nofollow"
            if request.path.startswith("/api/") and response.status_code in {404, 405}:
                from django.http import JsonResponse

                if not response.get("Content-Type", "").startswith("application/json"):
                    headers = dict(response.headers)
                    response = JsonResponse({"detail": "Not found."}, status=response.status_code)
                    for key, value in headers.items():
                        if key.lower() not in {"content-type", "content-length"}:
                            response[key] = value
            if response.status_code == 429 and not response.has_header("Retry-After"):
                response["Retry-After"] = "60"
        return response

    def process_view(self, request, view_func, view_args, view_kwargs):
        if request.path == "/django-admin/login/" and request.method == "POST":
            from allauth.core import ratelimit
            from django.http import JsonResponse

            identity = request.POST.get("username", "").strip().lower()[:254]
            if not ratelimit.consume(request, action="admin_login", key=identity):
                response = JsonResponse(
                    {"detail": "Too many attempts. Please retry later."}, status=429
                )
                response["Retry-After"] = "300"
                return response


class PublicReadErrorMiddleware:
    """Do not cache method errors or missing public routes outside normal view responses."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if response.status_code >= 400 and (
            request.path.startswith("/api/") or request.path.startswith("/shorts/")
        ):
            response["Cache-Control"] = "no-store"
        return response
