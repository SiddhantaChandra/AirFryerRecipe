from unittest.mock import Mock

import httpx
import pytest

from integrations.youtube import (
    YouTubeAPIError,
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
                    "id": SAMPLE_ID,
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


@pytest.mark.parametrize(
    "url",
    [
        f"https://youtu.be/{SAMPLE_ID}/extra",
        f"https://youtu.be//{SAMPLE_ID}",
        f"https://youtube.com/shorts/{SAMPLE_ID}/extra",
        f"https://youtube.com/shorts//{SAMPLE_ID}",
        f"https://youtube.com/shortstuff/{SAMPLE_ID}",
        f"https://youtube.com/watch/?v={SAMPLE_ID}",
        f"https://youtube.com/watch?v={SAMPLE_ID}&v=",
        f"https://youtube.com/watch?v={SAMPLE_ID}&v={SAMPLE_ID}",
        f"https://youtube.com/watch?v={SAMPLE_ID}&feature=share&feature=other",
        f"https://youtube.com/shorts/{SAMPLE_ID}?v=jNQXAC9IVRw",
        f"https://youtube.com/watch;extra?v={SAMPLE_ID}",
        f"https://youtube.com:80/watch?v={SAMPLE_ID}",
        f"http://youtube.com:443/watch?v={SAMPLE_ID}",
        f"https://youtube.com:0/watch?v={SAMPLE_ID}",
        f"https://youtube.com:invalid/watch?v={SAMPLE_ID}",
        f"https://youtube.com/shorts/{SAMPLE_ID}\nextra",
        f"https://youtube.com\\@attacker.example/shorts/{SAMPLE_ID}",
        "https://youtube.com/shorts/%75LIOVZNFlPE",
        "   ",
        None,
        123,
    ],
)
def test_ambiguous_urls_never_make_requests(url, monkeypatch):
    outbound = Mock(side_effect=AssertionError("Normalizer must not make requests"))
    monkeypatch.setattr(httpx.Client, "get", outbound)
    with pytest.raises(ValueError):
        normalize_youtube_url(url)
    outbound.assert_not_called()


def api_client(payload, status_code=200):
    client = Mock(spec=httpx.Client)
    response = Mock(spec=httpx.Response)
    response.status_code = status_code
    response.json.return_value = payload
    client.get.return_value = response
    return client


def test_missing_metadata_stays_unknown():
    client = api_client({"items": [{"id": SAMPLE_ID}]})
    result = fetch_youtube_metadata(SAMPLE_ID, api_key="test-key", client=client)
    assert result["found"] is True
    assert result["duration_seconds"] is None
    assert result["embeddable"] is None
    assert result["title"] == ""


def test_not_returned_is_distinct_from_temporary_failure():
    client = api_client({"items": []})
    result = fetch_youtube_metadata(SAMPLE_ID, api_key="test-key", client=client)
    assert result["found"] is False
    assert client.close.call_count == 0  # Caller owns an injected client's lifecycle.


@pytest.mark.parametrize("status_code", [403, 429, 500, 503])
def test_provider_failures_do_not_retain_payload(status_code):
    client = api_client({"error": {"message": "sensitive-provider-data"}}, status_code)
    with pytest.raises(YouTubeAPIError) as caught:
        fetch_youtube_metadata(SAMPLE_ID, api_key="secret-key", client=client)
    assert caught.value.status_code == status_code
    assert "sensitive-provider-data" not in str(caught.value)
    assert "secret-key" not in str(caught.value)
    assert not hasattr(caught.value, "response_data")
    client.get.return_value.json.assert_not_called()


def test_network_failure_does_not_expose_key_or_exception_chain():
    client = Mock(spec=httpx.Client)
    client.get.side_effect = httpx.ConnectError("https://example.test/?key=secret-key")
    with pytest.raises(YouTubeAPIError) as caught:
        fetch_youtube_metadata(SAMPLE_ID, api_key="secret-key", client=client)
    assert "secret-key" not in str(caught.value)
    assert caught.value.__suppress_context__ is True


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"items": {}},
        {"items": [None]},
        {"items": [{"id": "jNQXAC9IVRw"}]},
        {"items": [{"id": SAMPLE_ID}, {"id": SAMPLE_ID}]},
        {"items": [{"id": SAMPLE_ID, "snippet": None}]},
        {"items": [{"id": SAMPLE_ID, "status": []}]},
    ],
)
def test_invalid_provider_responses_are_not_successful_fetches(payload):
    with pytest.raises(YouTubeAPIError):
        fetch_youtube_metadata(SAMPLE_ID, api_key="test-key", client=api_client(payload))


def test_invalid_json_is_a_sanitized_provider_error():
    client = api_client(None)
    client.get.return_value.json.side_effect = ValueError("sensitive-body")
    with pytest.raises(YouTubeAPIError, match="invalid JSON"):
        fetch_youtube_metadata(SAMPLE_ID, api_key="test-key", client=client)


def test_invalid_identity_is_rejected_before_provider_call():
    client = Mock(spec=httpx.Client)
    with pytest.raises(ValueError):
        fetch_youtube_metadata("bad-id", api_key="test-key", client=client)
    client.get.assert_not_called()
