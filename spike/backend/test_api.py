import pytest
from rest_framework.test import APIClient
from unittest.mock import patch

@pytest.fixture
def client():
    return APIClient()

@pytest.mark.django_db
def test_preview_endpoint_success(client):
    mock_metadata = {
        "found": True,
        "video_id": "q6PhzE5Qp24",
        "title": "Air Fryer Samosa",
        "channel_title": "Cooking Shorts",
        "duration_seconds": 58,
        "thumbnails": {
            "high": {"url": "https://i.ytimg.com/vi/q6PhzE5Qp24/hqdefault.jpg"}
        },
        "embeddable": True,
        "privacy_status": "public",
    }
    with patch("views.fetch_youtube_metadata", return_value=mock_metadata):
        response = client.post(
            "/api/preview/",
            {"url": "https://www.youtube.com/shorts/q6PhzE5Qp24"},
            format="json",
        )
        assert response.status_code == 200
        data = response.json()
        assert data["found"] is True
        assert data["video_id"] == "q6PhzE5Qp24"
        assert data["title"] == "Air Fryer Samosa"

@pytest.mark.django_db
def test_preview_endpoint_invalid_url(client):
    response = client.post(
        "/api/preview/",
        {"url": "https://notyoutube.com/shorts/q6PhzE5Qp24"},
        format="json",
    )
    assert response.status_code == 400
    data = response.json()
    assert "error" in data

@pytest.mark.django_db
def test_preview_endpoint_missing_url(client):
    response = client.post("/api/preview/", {}, format="json")
    assert response.status_code == 400
