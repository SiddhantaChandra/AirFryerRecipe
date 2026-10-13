from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse


@pytest.mark.django_db
def test_admin_preview_enables_official_player_without_suppressing_referer(client):
    admin = get_user_model().objects.create_superuser(
        "player-check@example.invalid", "test-only-password"
    )
    client.force_login(admin)
    metadata = {"found": True, "video_id": "uLIOVZNFlPE", "embeddable": True}
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=metadata):
        response = client.post(
            reverse("admin:catalog_video_preview"),
            {"source_url": "https://www.youtube.com/shorts/uLIOVZNFlPE"},
        )
    assert response.status_code == 200
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "no-store" in response.headers["Cache-Control"]
    assert "enablejsapi=1" in response.context["embed_url"]
    assert "origin=http%3A%2F%2Ftestserver" in response.context["embed_url"]
    html = response.content.decode()
    assert 'referrerpolicy="strict-origin-when-cross-origin"' in html
    assert "catalog/preview-player.js" in html
    assert 'id="source-player-retry"' in html
