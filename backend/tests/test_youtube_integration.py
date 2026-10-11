from unittest.mock import Mock

import httpx
import pytest

from integrations.youtube import (
    fetch_youtube_metadata,
    normalize_youtube_url,
)

SAMPLE_ID = "uLIOVZNFlPE"


class TestYouTubeNormalizer:
    @pytest.mark.parametrize(
        "url",
        [
            f"https://www.youtube.com/shorts/{SAMPLE_ID}",
            f"http://www.youtube.com/shorts/{SAMPLE_ID}",
            f"https://youtube.com/shorts/{SAMPLE_ID}",
            f"https://m.youtube.com/shorts/{SAMPLE_ID}",
            f"https://www.youtube.com/watch?v={SAMPLE_ID}",
            f"http://youtube.com/watch?v={SAMPLE_ID}",
            f"https://m.youtube.com/watch?v={SAMPLE_ID}",
            f"https://youtu.be/{SAMPLE_ID}",
            f"http://youtu.be/{SAMPLE_ID}",
            f"https://www.youtube.com/watch?v={SAMPLE_ID}&feature=share",
            f"//youtube.com/shorts/{SAMPLE_ID}",
            f"youtube.com/shorts/{SAMPLE_ID}",
        ],
    )
    def test_valid_urls_normalize(self, url: str):
        assert normalize_youtube_url(url) == SAMPLE_ID

    @pytest.mark.parametrize(
        "url",
        [
            f"https://youtubee.com/shorts/{SAMPLE_ID}",
            f"https://youtube.com.attacker.com/shorts/{SAMPLE_ID}",
            f"https://notyoutube.com/watch?v={SAMPLE_ID}",
            "http://127.0.0.1:8000/shorts/test",
            "http://169.254.169.254/latest/meta-data/",
            f"https://user:pass@youtube.com/shorts/{SAMPLE_ID}",
            "https://www.youtube.com/channel/UC12345",
            "javascript:alert(1)",
            "",
        ],
    )
    def test_invalid_urls_rejected(self, url: str):
        with pytest.raises(ValueError):
            normalize_youtube_url(url)


class TestYouTubeAPIClient:
    def test_fetch_metadata_mocked(self):
        mock_client = Mock(spec=httpx.Client)
        mock_resp = Mock(spec=httpx.Response)
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "items": [
                {
                    "snippet": {
                        "title": "Air Fryer Crispy Okra",
                        "channelTitle": "Recipe Channel",
                        "channelId": "UC999",
                        "publishedAt": "2026-05-01T00:00:00Z",
                        "description": "Crispy okra in air fryer",
                        "thumbnails": {
                            "high": {"url": "https://i.ytimg.com/vi/uLIOVZNFlPE/hqdefault.jpg"}
                        },
                    },
                    "contentDetails": {"duration": "PT2M4S"},
                    "status": {
                        "privacyStatus": "public",
                        "embeddable": True,
                        "uploadStatus": "processed",
                    },
                }
            ]
        }
        mock_client.get.return_value = mock_resp

        data = fetch_youtube_metadata(SAMPLE_ID, api_key="dummy_key", client=mock_client)
        assert data["found"] is True
        assert data["title"] == "Air Fryer Crispy Okra"
        assert data["duration_seconds"] == 124
        assert data["embeddable"] is True
