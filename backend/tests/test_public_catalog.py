import json
from datetime import timedelta
from unittest.mock import patch

import httpx
import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone

from apps.catalog.models import Video
from apps.catalog.public import FEED_LIMIT
from common.vite import vite_assets

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def dev_assets(settings):
    settings.VITE_DEV_SERVER = "http://localhost:5173"


@pytest.fixture
def make_video():
    index = 0

    def create(status="PUBLISHED", **kwargs):
        nonlocal index
        index += 1
        return Video.objects.create(
            external_id=f"test{index:07d}",
            recipe_name=f"Curated recipe {index}",
            recipe_summary="Manually reviewed summary <script>unsafe</script>",
            status=status,
            diet_reviewed=True,
            air_fryer_confirmed=True,
            reviewed_at=timezone.now(),
            last_metadata_sync_at=timezone.now(),
            creator_name="Current creator",
            thumbnail_url="https://i.ytimg.com/source.jpg",
            availability="OK",
            embeddable=True,
            **kwargs,
        )

    return create


def test_finite_feed_published_only_stable_ties(client, make_video):
    drafts = [make_video("DRAFT"), make_video("HIDDEN")]
    videos = [make_video() for _ in range(FEED_LIMIT + 2)]
    Video.objects.all().update(created_at=timezone.now())
    response = client.get(reverse("public_feed"))
    body = response.json()
    assert body["count"] == FEED_LIMIT + 2
    assert len(body["results"]) == FEED_LIMIT
    assert [v["id"] for v in body["results"]] == [
        str(v.id) for v in sorted(videos, key=lambda v: v.id, reverse=True)[:FEED_LIMIT]
    ]
    assert all(v.slug not in response.content.decode() for v in drafts)
    assert "added_by" not in body["results"][0]
    assert "source_description" not in body["results"][0]
    assert "last_sync_error" not in body["results"][0]
    assert "diet_policy" in body


@pytest.mark.parametrize("status", ["DRAFT", "HIDDEN"])
@pytest.mark.parametrize("route", ["public_detail", "public_neighbors", "watch", "watch_slash"])
def test_hidden_draft_and_missing_are_no_store_404(client, make_video, status, route):
    video = make_video(status)
    for slug in (video.slug, "does-not-exist"):
        response = client.get(reverse(route, args=(slug,)), HTTP_IF_NONE_MATCH="*")
        assert response.status_code == 404
        assert "no-store" in response.headers["Cache-Control"]
        assert video.recipe_name not in response.content.decode()
        assert "Set-Cookie" not in response.headers
        assert not response.cookies


def test_neighbor_order_boundaries_and_rechecks(client, make_video):
    videos = [make_video() for _ in range(4)]
    Video.objects.all().update(created_at=timezone.now())
    videos.sort(key=lambda v: v.id, reverse=True)

    def get(video):
        return client.get(reverse("public_neighbors", args=(video.slug,))).json()

    assert get(videos[0])["previous"] is None
    assert get(videos[-1])["next"] is None
    assert get(videos[1])["previous"]["id"] == str(videos[0].id)
    assert get(videos[1])["next"]["id"] == str(videos[2].id)
    Video.objects.filter(pk=videos[2].pk).update(status="HIDDEN")
    assert get(videos[1])["next"]["id"] == str(videos[3].id)
    hidden = client.get(reverse("public_neighbors", args=(videos[2].slug,)))
    assert hidden.status_code == 404


def test_expiry_changes_validators_without_losing_editorial_content(client, make_video):
    video = make_video()
    url = reverse("public_detail", args=(video.slug,))
    original = client.get(url)
    assert original.json()["creator_name"] == "Current creator"
    assert client.get(url, HTTP_IF_NONE_MATCH=original["ETag"]).status_code == 304
    Video.objects.filter(pk=video.pk).update(
        last_metadata_sync_at=timezone.now() - timedelta(days=30)
    )
    with patch(
        "integrations.youtube.fetch_youtube_metadata", side_effect=AssertionError("no fetch")
    ):
        expired = client.get(url, HTTP_IF_NONE_MATCH=original["ETag"])
        feed = client.get(reverse("public_feed")).json()
        html = client.get(reverse("watch", args=(video.slug,))).content.decode()
    assert expired.status_code == 200
    assert expired.json()["creator_name"] is None
    assert expired.json()["thumbnail_url"] is None
    assert expired.json()["availability"] == "UNKNOWN"
    assert expired.json()["recipe_name"] == video.recipe_name
    assert feed["results"][0]["thumbnail_url"] is None
    assert "Current creator" not in html and "https://i.ytimg.com/source.jpg" not in html
    video.refresh_from_db()
    assert video.status == "PUBLISHED" and video.thumbnail_url == ""


@pytest.mark.parametrize("route", ["public_feed", "public_detail", "public_neighbors", "watch"])
def test_public_cookie_free_and_does_not_load_session(client, make_video, route):
    video = make_video()
    user = get_user_model().objects.create_superuser("public-check@example.invalid", "test-pass")
    client.force_login(user)
    args = () if route == "public_feed" else (video.slug,)
    url = reverse(route, args=args)
    with patch(
        "django.contrib.sessions.backends.db.SessionStore.load",
        side_effect=AssertionError("session read"),
    ):
        response = client.get(url)
        conditional = client.get(url, HTTP_IF_NONE_MATCH="W/" + response["ETag"])
    assert response.status_code == 200 and conditional.status_code == 304
    assert not response.cookies and not conditional.cookies
    assert response["Cache-Control"] == "public, max-age=0, must-revalidate"
    assert "Cookie" not in response.get("Vary", "")
    assert "public-check" not in response.content.decode()


def test_hide_invalidates_feed_detail_html_and_neighbors(client, make_video):
    video = make_video()
    urls = [
        reverse("public_feed"),
        *[
            reverse(route, args=(video.slug,))
            for route in ("public_detail", "public_neighbors", "watch")
        ],
    ]
    responses = [client.get(url) for url in urls]
    Video.objects.filter(pk=video.pk).update(status="HIDDEN")
    for url, old in zip(urls, responses, strict=True):
        new = client.get(url, HTTP_IF_NONE_MATCH=old["ETag"])
        assert new.status_code == (200 if url == urls[0] else 404)
        assert video.recipe_name not in new.content.decode()


@pytest.mark.parametrize(
    "query", ["q=potato", "sort=newest", "limit=2000", "diet=VEG", "cursor=abc"]
)
def test_phase_four_query_parameters_are_rejected(client, make_video, query):
    video = make_video()
    for url in (
        reverse("public_feed"),
        reverse("public_detail", args=(video.slug,)),
        reverse("public_neighbors", args=(video.slug,)),
    ):
        response = client.get(url + "?" + query)
        assert response.status_code == 400
        assert "no-store" in response["Cache-Control"]


def test_watch_no_js_content_metadata_and_development_entry(client, make_video):
    video = make_video()
    response = client.get(reverse("watch", args=(video.slug,)))
    html = response.content.decode()
    assert html.count("<h1") == 1
    assert video.recipe_name in html and "&lt;script&gt;unsafe&lt;/script&gt;" in html
    assert '<link rel="canonical" href="http://testserver/shorts/' in html
    assert "og:image" in html and "twitter:title" in html
    assert "View original on YouTube" in html and "<noscript>" in html
    assert "@vite/client" in html and "@react-refresh" in html
    assert "http://localhost:5173/src/main.jsx" in html
    assert 'id="watch-root"' in html


def test_manifest_resolves_imported_css_and_built_watch_html(
    settings, tmp_path, client, make_video
):
    manifest = {
        "src/main.jsx": {
            "file": "assets/main-123.js",
            "imports": ["shared"],
            "css": ["assets/main-123.css"],
        },
        "shared": {"file": "assets/shared-456.js", "css": ["assets/shared-456.css"]},
    }
    settings.VITE_DEV_SERVER = ""
    settings.VITE_MANIFEST_PATH = tmp_path / "manifest.json"
    settings.VITE_MANIFEST_PATH.write_text(json.dumps(manifest), encoding="utf-8")
    assert vite_assets()["css"] == ["/assets/shared-456.css", "/assets/main-123.css"]
    html = client.get(reverse("watch", args=(make_video().slug,))).content.decode()
    assert "/assets/main-123.js" in html and "/assets/shared-456.css" in html
    assert 'rel="modulepreload" href="/assets/shared-456.js"' in html
    assert "@vite/client" not in html and "@react-refresh" not in html


def test_bounded_feed_avoids_source_query_per_card(
    client, make_video, django_assert_max_num_queries
):
    for _ in range(FEED_LIMIT):
        make_video()
    with django_assert_max_num_queries(8):
        response = client.get(reverse("public_feed"))
    assert len(response.json()["results"]) == FEED_LIMIT


def test_public_head_and_denied_mutations(client, make_video):
    video = make_video()
    for route in ("public_feed", "public_detail", "public_neighbors"):
        args = () if route == "public_feed" else (video.slug,)
        url = reverse(route, args=args)
        get = client.get(url)
        head = client.head(url)
        assert head.status_code == 200 and head.content == b""
        assert head["ETag"] == get["ETag"]
        post = client.post(url, {"status": "PUBLISHED"})
        assert post.status_code == 405 and post["Cache-Control"] == "no-store"
    video.refresh_from_db()
    assert video.status == "PUBLISHED"


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("mode", ["development", "built"])
def test_direct_watch_with_real_http_and_disposable_record(live_server, settings, make_video, mode):
    if mode == "built":
        settings.VITE_DEV_SERVER = ""
        if not settings.VITE_MANIFEST_PATH.exists():
            pytest.skip("Build the frontend before this built-mode HTTP integration check.")
    video = make_video()
    with httpx.Client(base_url=live_server.url, trust_env=False) as browser:
        for path in (f"/shorts/{video.slug}", f"/shorts/{video.slug}/"):
            response = browser.get(path)
            assert response.status_code == 200
            assert "<h1" in response.text and video.recipe_name in response.text
            assert "<noscript>" in response.text
            assert "set-cookie" not in response.headers
            assert ("@vite/client" in response.text) is (mode == "development")
            assert (
                browser.get(path, headers={"If-None-Match": response.headers["etag"]}).status_code
                == 304
            )
        Video.objects.filter(pk=video.pk).update(status="HIDDEN")
        hidden = browser.get(f"/shorts/{video.slug}")
        assert hidden.status_code == 404 and hidden.headers["cache-control"] == "no-store"
