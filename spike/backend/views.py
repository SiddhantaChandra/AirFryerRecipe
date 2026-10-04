from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from normalizer import normalize_youtube_url
from youtube import fetch_youtube_metadata, YouTubeAPIError


@api_view(["POST"])
def preview_video(request):
    """
    Spike endpoint to accept a YouTube URL and return normalized video ID + metadata.
    Does not require authentication in Phase 0 feasibility spike.
    """
    url = request.data.get("url")
    if not url or not isinstance(url, str):
        return Response(
            {"error": "Please provide a 'url' string parameter."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 1. Strict URL normalization (SSRF protected)
    try:
        video_id = normalize_youtube_url(url)
    except ValueError as exc:
        return Response(
            {"error": str(exc), "video_id": None},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 2. Server-side YouTube Data API query
    api_key = getattr(settings, "YOUTUBE_API_KEY", "")
    try:
        metadata = fetch_youtube_metadata(video_id, api_key=api_key)
    except YouTubeAPIError as exc:
        return Response(
            {
                "error": str(exc),
                "video_id": video_id,
                "api_error": True,
            },
            status=status.HTTP_502_BAD_GATEWAY if exc.status_code != 500 else status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    except Exception as exc:
        return Response(
            {"error": f"Unexpected error: {exc}", "video_id": video_id},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response(metadata, status=status.HTTP_200_OK)
