from django.db import connection
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def healthz(request):
    """
    Unauthenticated liveness and readiness probe.
    Checks database connectivity without leaking sensitive data.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1;")
            cursor.fetchone()
        return Response({"status": "ok", "db": "ok"}, status=status.HTTP_200_OK)
    except Exception:
        return Response(
            {"status": "unhealthy", "db": "unavailable"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
