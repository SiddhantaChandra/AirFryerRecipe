"""
Unit tests for YouTube URL normalizer and metadata retrieval.
Verifies ARCHITECTURE.md §4.1:
- Valid URLs normalize to one ID.
- Malformed, wrong-host, look-alikes, SSRF vectors are rejected.
- No network call occurs during normalization.
- YouTube API caller is tested with mocks (no live API dependency in unit tests).
"""

import pytest
import httpx
from unittest.mock import Mock
from normalizer import normalize_youtube_url
from youtube import (
    fetch_youtube_metadata,
    parse_iso8601_duration,
    YouTubeAPIError,
)

SAMPLE_VALID_ID = "q6PhzE5Qp24"


class TestYouTubeNormalizer:
    @pytest.mark.parametrize(
        "url",
        [
            f"https://www.youtube.com/shorts/{SAMPLE_VALID_ID}",
            f"http://www.youtube.com/shorts/{SAMPLE_VALID_ID}",
            f"https://youtube.com/shorts/{SAMPLE_VALID_ID}",
            f"https://m.youtube.com/shorts/{SAMPLE_VALID_ID}",
            f"https://www.youtube.com/watch?v={SAMPLE_VALID_ID}",
            f"http://youtube.com/watch?v={SAMPLE_VALID_ID}",
            f"https://m.youtube.com/watch?v={SAMPLE_VALID_ID}",
            f"https://youtu.be/{SAMPLE_VALID_ID}",
            f"http://youtu.be/{SAMPLE_VALID_ID}",
            f"https://www.youtube.com/watch?v={SAMPLE_VALID_ID}&feature=share",
            f"//youtube.com/shorts/{SAMPLE_VALID_ID}",
            f"youtube.com/shorts/{SAMPLE_VALID_ID}",
        ],
    )
    def test_valid_urls_normalize_to_same_id(self, url: str):
        result = normalize_youtube_url(url)
        assert result == SAMPLE_VALID_ID

    @pytest.mark.parametrize(
        "url,expected_reason",
        [
            # Look-alike / phishing domains
            (f"https://youtubee.com/shorts/{SAMPLE_VALID_ID}", "not a recognized YouTube domain"),
            (f"https://youtube.com.attacker.com/shorts/{SAMPLE_VALID_ID}", "not a recognized YouTube domain"),
            (f"https://notyoutube.com/watch?v={SAMPLE_VALID_ID}", "not a recognized YouTube domain"),
            (f"https://youtu.be.attacker.com/{SAMPLE_VALID_ID}", "not a recognized YouTube domain"),
            # SSRF attempts
            ("http://127.0.0.1:8000/shorts/q6PhzE5Qp24", "not a recognized YouTube domain"),
            ("http://localhost/watch?v=q6PhzE5Qp24", "not a recognized YouTube domain"),
            ("http://169.254.169.254/latest/meta-data/", "not a recognized YouTube domain"),
            # Non-standard ports
            (f"https://youtube.com:8443/shorts/{SAMPLE_VALID_ID}", "Non-standard ports"),
            # Credential injection
            (f"https://user:pass@youtube.com/shorts/{SAMPLE_VALID_ID}", "URLs containing credentials"),
            # Unsupported paths
            ("https://www.youtube.com/channel/UC1234567890123456789012", "Unsupported path"),
            ("https://www.youtube.com/playlist?list=PL1234567890", "Unsupported path"),
            ("https://www.youtube.com/user/pewdiepie", "Unsupported path"),
            # Malformed IDs
            ("https://www.youtube.com/shorts/too_short", "Invalid YouTube video ID format"),
            ("https://www.youtube.com/shorts/this_id_is_way_too_long_for_yt", "Invalid YouTube video ID format"),
            ("https://www.youtube.com/watch?v=invalid!@#$", "Invalid YouTube video ID format"),
            ("https://youtu.be/invalid$char", "Invalid YouTube video ID format"),
            # Dangerous schemes
            (f"javascript:alert(1)//youtube.com/shorts/{SAMPLE_VALID_ID}", "Unsupported URL scheme"),
            ("file:///etc/passwd", "Unsupported URL scheme"),
            # Missing inputs
            ("", "URL must be a non-empty string"),
            (None, "URL must be a non-empty string"),
        ],
    )
    def test_invalid_and_malicious_urls_rejected(self, url: str | None, expected_reason: str):
        with pytest.raises(ValueError) as exc_info:
            normalize_youtube_url(url)
        assert expected_reason.lower() in str(exc_info.value).lower()


class TestDurationParser:
    @pytest.mark.parametrize(
        "duration_str,expected_seconds",
        [
            ("PT59S", 59),
            ("PT1M", 60),
            ("PT1M15S", 75),
            ("PT2M30S", 150),
            ("PT1H2M3S", 3723),
            ("", None),
            (None, None),
            ("INVALID", None),
            ("1:30", None),
        ],
    )
    def test_duration_parsing(self, duration_str: str | None, expected_seconds: int | None):
        assert parse_iso8601_duration(duration_str) == expected_seconds


class TestYouTubeClientMocked:
    def test_fetch_metadata_success(self):
        mock_response_data = {
            "items": [
                {
                    "snippet": {
                        "title": "Crispy Air Fryer Potatoes",
                        "channelTitle": "Chef AirFryer",
                        "channelId": "UC12345",
                        "publishedAt": "2026-01-01T12:00:00Z",
                        "description": "Easy crispy air fryer potatoes recipe",
                        "thumbnails": {
                            "high": {"url": "https://i.ytimg.com/vi/q6PhzE5Qp24/hqdefault.jpg", "width": 480, "height": 360}
                        },
                    },
                    "contentDetails": {
                        "duration": "PT45S"
                    },
                    "status": {
                        "privacyStatus": "public",
                        "embeddable": True,
                        "uploadStatus": "processed",
                    },
                }
            ]
        }

        mock_client = Mock(spec=httpx.Client)
        mock_resp = Mock(spec=httpx.Response)
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_response_data
        mock_client.get.return_value = mock_resp

        result = fetch_youtube_metadata(SAMPLE_VALID_ID, api_key="test-api-key", client=mock_client)
        assert result["found"] is True
        assert result["title"] == "Crispy Air Fryer Potatoes"
        assert result["channel_title"] == "Chef AirFryer"
        assert result["duration_seconds"] == 45
        assert result["embeddable"] is True
        assert result["privacy_status"] == "public"
        assert "high" in result["thumbnails"]

    def test_fetch_metadata_not_found_or_private(self):
        mock_client = Mock(spec=httpx.Client)
        mock_resp = Mock(spec=httpx.Response)
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"items": []}
        mock_client.get.return_value = mock_resp

        result = fetch_youtube_metadata("nonexistent1", api_key="test-api-key", client=mock_client)
        assert result["found"] is False
        assert "not found" in result["reason"].lower()

    def test_fetch_metadata_quota_exceeded(self):
        mock_client = Mock(spec=httpx.Client)
        mock_resp = Mock(spec=httpx.Response)
        mock_resp.status_code = 403
        mock_resp.json.return_value = {
            "error": {
                "message": "The request cannot be completed because you have exceeded your quota.",
                "errors": [{"reason": "quotaExceeded"}],
            }
        }
        mock_client.get.return_value = mock_resp

        with pytest.raises(YouTubeAPIError) as exc_info:
            fetch_youtube_metadata(SAMPLE_VALID_ID, api_key="test-api-key", client=mock_client)
        assert "quota" in str(exc_info.value).lower()
        assert exc_info.value.status_code == 403
