"""
YouTube integration module for Air Fryer Recipe Archive.
Complies with ARCHITECTURE.md §4.1:
- Normalizes YouTube URLs without making outbound requests to pasted URLs.
- Calls YouTube Data API server-side using configured credentials.
"""

import os
import re
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from django.conf import settings

YOUTUBE_VIDEO_ID_REGEX = re.compile(r"^[a-zA-Z0-9_-]{11}$")
ALLOWED_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com"}
ALLOWED_SHORT_HOSTS = {"youtu.be"}

YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/videos"
ISO_DURATION_REGEX = re.compile(
    r"^PT(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?$"
)


def normalize_youtube_url(url: str) -> str:
    """
    Validates and extracts an 11-character YouTube video ID from a supported URL.

    Raises:
        ValueError: If the URL is unsupported, malformed, or malicious.
    """
    if not url or not isinstance(url, str):
        raise ValueError("URL must be a non-empty string.")

    raw_url = url.strip()

    if raw_url.startswith("//"):
        raw_url = "https:" + raw_url
    else:
        initial_parse = urlparse(raw_url)
        if not initial_parse.scheme:
            raw_url = "https://" + raw_url

    try:
        parsed = urlparse(raw_url)
    except Exception as exc:
        raise ValueError(f"Malformed URL: {exc}") from exc

    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")

    try:
        hostname = (parsed.hostname or "").lower()
    except Exception as exc:
        raise ValueError(f"Invalid hostname in URL: {exc}") from exc

    if not hostname:
        raise ValueError("URL must contain a valid hostname.")

    if hostname not in ALLOWED_YOUTUBE_HOSTS and hostname not in ALLOWED_SHORT_HOSTS:
        raise ValueError(f"Host '{hostname}' is not a recognized YouTube domain.")

    if parsed.username or parsed.password:
        raise ValueError("URLs containing credentials are not permitted.")

    try:
        if parsed.port and parsed.port not in {80, 443}:
            raise ValueError("Non-standard ports are not allowed.")
    except ValueError as exc:
        if "Non-standard ports" in str(exc):
            raise
        raise ValueError(f"Invalid port in URL: {exc}") from exc

    video_id: str | None = None

    if hostname in ALLOWED_SHORT_HOSTS:
        path_parts = [p for p in parsed.path.split("/") if p]
        if not path_parts:
            raise ValueError("Missing video ID in youtu.be URL.")
        candidate_id = path_parts[0]
        if not YOUTUBE_VIDEO_ID_REGEX.match(candidate_id):
            raise ValueError(f"Invalid YouTube video ID format: {candidate_id}")
        video_id = candidate_id

    elif hostname in ALLOWED_YOUTUBE_HOSTS:
        path = parsed.path.rstrip("/")
        if path.startswith("/shorts"):
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 2:
                candidate_id = parts[1]
                if not YOUTUBE_VIDEO_ID_REGEX.match(candidate_id):
                    raise ValueError(f"Invalid YouTube video ID format: {candidate_id}")
                video_id = candidate_id
            else:
                raise ValueError("Missing video ID in shorts URL.")
        elif path == "/watch":
            query_params = parse_qs(parsed.query, keep_blank_values=False)
            v_params = query_params.get("v")
            if v_params and len(v_params) == 1:
                candidate_id = v_params[0]
                if not YOUTUBE_VIDEO_ID_REGEX.match(candidate_id):
                    raise ValueError(
                        f"Invalid YouTube video ID format in 'v' parameter: {candidate_id}"
                    )
                video_id = candidate_id
            else:
                raise ValueError("Missing or multiple 'v' parameters in watch URL.")
        else:
            raise ValueError(f"Unsupported path for youtube.com URL: {parsed.path}")

    if not video_id or not YOUTUBE_VIDEO_ID_REGEX.match(video_id):
        raise ValueError("Could not extract a valid 11-character YouTube video ID.")

    return video_id


def parse_iso8601_duration(duration_str: str | None) -> int | None:
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


def fetch_youtube_metadata(
    video_id: str, api_key: str | None = None, client: httpx.Client | None = None
) -> dict[str, Any]:
    key = (
        api_key
        or getattr(settings, "YOUTUBE_API_KEY", "")
        or os.getenv("YOUTUBE_API_KEY", "").strip()
    )
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
