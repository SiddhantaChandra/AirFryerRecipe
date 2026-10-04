"""
Strict YouTube URL normalizer for Air Fryer Recipe Archive.
Complies with ARCHITECTURE.md §4.1:
- Accepts only youtube.com/shorts/{id}, youtube.com/watch?v={id}, youtu.be/{id}
  (with optional 'www.' and 'm.' subdomains for youtube.com).
- Host and path validation only.
- NEVER makes outbound HTTP requests to user-pasted URLs (SSRF prevention).
- Rejects look-alikes, IP addresses, credentials in URL, and invalid schemes.
"""

import re
from urllib.parse import urlparse, parse_qs

YOUTUBE_VIDEO_ID_REGEX = re.compile(r"^[a-zA-Z0-9_-]{11}$")
ALLOWED_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com"}
ALLOWED_SHORT_HOSTS = {"youtu.be"}


def normalize_youtube_url(url: str) -> str:
    """
    Validates and extracts an 11-character YouTube video ID from a supported URL.
    
    Raises:
        ValueError: If the URL is unsupported, malformed, or malicious.
    """
    if not url or not isinstance(url, str):
        raise ValueError("URL must be a non-empty string.")

    raw_url = url.strip()

    # Prepend scheme if scheme-relative
    if raw_url.startswith("//"):
        raw_url = "https:" + raw_url
    else:
        # Check if scheme exists before prepending https://
        initial_parse = urlparse(raw_url)
        if not initial_parse.scheme:
            raw_url = "https://" + raw_url

    try:
        parsed = urlparse(raw_url)
    except Exception as exc:
        raise ValueError(f"Malformed URL: {exc}") from exc

    # 1. Scheme validation: strictly http or https BEFORE evaluating host/port
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")

    # 2. Host validation
    try:
        hostname = (parsed.hostname or "").lower()
    except Exception as exc:
        raise ValueError(f"Invalid hostname in URL: {exc}") from exc

    if not hostname:
        raise ValueError("URL must contain a valid hostname.")

    if hostname not in ALLOWED_YOUTUBE_HOSTS and hostname not in ALLOWED_SHORT_HOSTS:
        raise ValueError(f"Host '{hostname}' is not a recognized YouTube domain.")

    # 3. No userinfo (e.g. user:pass@host)
    if parsed.username or parsed.password:
        raise ValueError("URLs containing credentials are not permitted.")

    # 4. Standard ports only
    try:
        if parsed.port and parsed.port not in {80, 443}:
            raise ValueError("Non-standard ports are not allowed.")
    except ValueError as exc:
        if "Non-standard ports" in str(exc):
            raise
        raise ValueError(f"Invalid port in URL: {exc}") from exc

    video_id: str | None = None

    if hostname in ALLOWED_SHORT_HOSTS:
        # Format: youtu.be/{id}
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
            # parts will be ['shorts', '{id}']
            if len(parts) >= 2:
                candidate_id = parts[1]
                if not YOUTUBE_VIDEO_ID_REGEX.match(candidate_id):
                    raise ValueError(f"Invalid YouTube video ID format: {candidate_id}")
                video_id = candidate_id
            else:
                raise ValueError("Missing video ID in shorts URL.")
        elif path == "/watch":
            # Check watch query: ?v={id}
            query_params = parse_qs(parsed.query, keep_blank_values=False)
            v_params = query_params.get("v")
            if v_params and len(v_params) == 1:
                candidate_id = v_params[0]
                if not YOUTUBE_VIDEO_ID_REGEX.match(candidate_id):
                    raise ValueError(f"Invalid YouTube video ID format in 'v' parameter: {candidate_id}")
                video_id = candidate_id
            else:
                raise ValueError("Missing or multiple 'v' parameters in watch URL.")
        else:
            raise ValueError(f"Unsupported path for youtube.com URL: {parsed.path}")

    if not video_id or not YOUTUBE_VIDEO_ID_REGEX.match(video_id):
        raise ValueError("Could not extract a valid 11-character YouTube video ID.")

    return video_id
