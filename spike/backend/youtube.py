"""
YouTube Data API v3 client using httpx.
Complies with ARCHITECTURE.md §4.1:
- Uses server-side API key.
- Requests parts: snippet, contentDetails, status.
- Tolerates missing fields; never fabricates values.
- Parses ISO 8601 durations without extra heavy dependencies.
"""

import os
import re
from typing import Any
import httpx

YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/videos"
ISO_DURATION_REGEX = re.compile(
    r"^PT(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?$"
)


def parse_iso8601_duration(duration_str: str | None) -> int | None:
    """
    Parses an ISO 8601 duration (e.g. PT1M15S, PT59S) into total seconds.
    Returns None if missing, malformed, or cannot be parsed.
    """
    if not duration_str or not isinstance(duration_str, str):
        return None
    match = ISO_DURATION_REGEX.match(duration_str)
    if not match:
        return None
    parts = match.groupdict()
    hours = int(parts.get("hours") or 0)
    minutes = int(parts.get("minutes") or 0)
    seconds = int(parts.get("seconds") or 0)
    return hours * 3600 + minutes * 60 + seconds


class YouTubeAPIError(Exception):
    def __init__(self, message: str, status_code: int | None = None, response_data: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_data = response_data


def fetch_youtube_metadata(video_id: str, api_key: str | None = None, client: httpx.Client | None = None) -> dict[str, Any]:
    """
    Fetches video metadata from YouTube Data API v3.
    """
    key = api_key or os.getenv("YOUTUBE_API_KEY", "").strip()
    if not key:
        raise YouTubeAPIError("YOUTUBE_API_KEY is not configured.", status_code=500)

    params = {
        "part": "snippet,contentDetails,status",
        "id": video_id,
        "key": key,
    }

    should_close = False
    if client is None:
        client = httpx.Client(timeout=10.0)
        should_close = True

    try:
        response = client.get(YOUTUBE_API_URL, params=params)
    except httpx.RequestError as exc:
        raise YouTubeAPIError(f"Network error contacting YouTube Data API: {exc}") from exc
    finally:
        if should_close:
            client.close()

    if response.status_code != 200:
        error_msg = f"YouTube API returned HTTP {response.status_code}"
        try:
            err_json = response.json()
            if "error" in err_json and "message" in err_json["error"]:
                error_msg = f"{error_msg}: {err_json['error']['message']}"
        except Exception:
            err_json = response.text
        raise YouTubeAPIError(error_msg, status_code=response.status_code, response_data=err_json)

    data = response.json()
    items = data.get("items", [])
    if not items:
        # Video does not exist, is private, or was removed
        return {
            "found": False,
            "video_id": video_id,
            "reason": "Video not found, private, or removed.",
        }

    item = items[0]
    snippet = item.get("snippet", {})
    content_details = item.get("contentDetails", {})
    status = item.get("status", {})

    duration_iso = content_details.get("duration")
    duration_seconds = parse_iso8601_duration(duration_iso)

    return {
        "found": True,
        "video_id": video_id,
        "title": snippet.get("title", ""),
        "channel_title": snippet.get("channelTitle", ""),
        "channel_id": snippet.get("channelId", ""),
        "published_at": snippet.get("publishedAt"),
        "description": snippet.get("description", ""),
        "duration_iso": duration_iso,
        "duration_seconds": duration_seconds,
        "thumbnails": snippet.get("thumbnails", {}),
        "privacy_status": status.get("privacyStatus", "unknown"),
        "embeddable": status.get("embeddable", False),
        "upload_status": status.get("uploadStatus", "unknown"),
    }
