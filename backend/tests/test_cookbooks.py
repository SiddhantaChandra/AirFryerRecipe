from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.db import IntegrityError, close_old_connections, connection, transaction
from django.db.models.deletion import Collector, ProtectedError
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Video
from apps.cookbooks.models import Cookbook, CookbookItem, VideoLike

PASSWORD = "Phase6-test-password-490!"
BASE = "/api/v1/cookbooks/"


@pytest.fixture
def owner():
    return User.objects.create_user("phase6-owner@example.invalid", PASSWORD)


@pytest.fixture
def browser(owner):
    client = Client(enforce_csrf_checks=True)
    client.force_login(owner)
    token = client.get("/api/v1/auth/bootstrap/").json()["csrf_token"]
    client.defaults["HTTP_X_CSRFTOKEN"] = token
    return client


@pytest.fixture
def video():
    return make_video()


def make_video(**changes):
    values = {
        "external_id": uuid4().hex[:11],
        "recipe_name": "Curated recipe आलू আলু",
        "status": "PUBLISHED",
        "diet_reviewed": True,
        "air_fryer_confirmed": True,
        "reviewed_at": timezone.now(),
        "last_metadata_sync_at": timezone.now(),
        "creator_name": "QA creator",
        "thumbnail_url": "https://i.ytimg.com/qa.jpg",
        "availability": "OK",
        "embeddable": True,
    }
    values.update(changes)
    return Video.objects.create(**values)


def send(client, method, url, data=None, **extra):
    return getattr(client, method)(
        url, {} if data is None else data, content_type="application/json", **extra
    )


def private(response):
    assert "private" in response["Cache-Control"]
    assert "no-store" in response["Cache-Control"]
    assert response["X-Robots-Tag"] == "noindex, nofollow"
    assert response.status_code != 304


def create(client, name="Weeknight recipes"):
    response = send(client, "post", BASE, {"name": name})
    assert response.status_code == 201, response.content
    return BASE + response.json()["id"] + "/"


def saved(client, path, video):
    response = send(client, "post", path + "items/", {"video_id": str(video.pk)})
    assert response.status_code == 200, response.content


@pytest.mark.django_db
def test_multiple_memberships_idempotence_limits_reorder_remove(browser, owner, video, settings):
    settings.COOKBOOK_OWNER_LIMIT = 2
    settings.COOKBOOK_ITEM_LIMIT = 2
    first, second = create(browser), create(browser)  # Duplicate names are allowed.
    assert send(browser, "post", BASE, {"name": "Over limit"}).status_code == 409
    for path in (first, second):
        saved(browser, path, video)
        saved(browser, path, video)
    another, third = make_video(), make_video()
    saved(browser, first, another)
    saved(browser, first, video)  # Retry at capacity is successful.
    assert send(browser, "post", first + "items/", {"video_id": str(third.pk)}).status_code == 409
    state = browser.get(f"/api/v1/me/video-state/?ids={video.pk}").json()["results"][str(video.pk)]
    assert set(state["cookbook_ids"]) == {first.split("/")[-2], second.split("/")[-2]}
    ids = [str(another.pk), str(video.pk)]
    assert send(browser, "patch", first + "reorder/", {"video_ids": ids}).status_code == 200
    detail = browser.get(first).json()
    assert [item["video_id"] for item in detail["items"]] == ids
    assert [item["position"] for item in detail["items"]] == [0, 1]
    for bad in [ids * 2, ids[:1], [str(uuid4()), str(video.pk)], [None], "invalid"]:
        assert send(browser, "patch", first + "reorder/", {"video_ids": bad}).status_code in {
            400,
            409,
        }
    assert [item["video_id"] for item in browser.get(first).json()["items"]] == ids
    remove = first + f"items/{another.pk}/"
    assert send(browser, "delete", remove).status_code == 204
    assert send(browser, "delete", remove).status_code == 204
    assert browser.get(first).json()["items"][0]["position"] == 0
    assert (
        send(browser, "patch", first, {"name": "नया রান্না", "description": "Private"}).status_code
        == 200
    )
    assert send(browser, "delete", first).status_code == 204
    assert browser.get(second).json()["count"] == 1
    assert Video.objects.filter(pk=video.pk).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["anonymous", "inactive", "other", "staff"])
@pytest.mark.parametrize(
    "operation",
    [
        "list",
        "state",
        "detail",
        "rename",
        "delete",
        "add",
        "remove",
        "reorder",
        "create",
        "like",
        "unlike",
    ],
)
def test_permissions_matrix(browser, owner, video, role, operation):
    book = Cookbook.objects.create(user=owner, name="Private owner name")
    CookbookItem.objects.create(cookbook=book, video=video, position=0)
    target = BASE + str(book.pk) + "/"
    client = Client()
    actor = None
    if role != "anonymous":
        actor = User.objects.create_user(
            f"{role}@example.invalid",
            PASSWORD,
            is_active=role != "inactive",
            is_staff=role == "staff",
        )
        client.force_login(actor)
    requests = {
        "list": ("get", BASE, None),
        "state": ("get", f"/api/v1/me/video-state/?ids={video.pk}", None),
        "detail": ("get", target, None),
        "rename": ("patch", target, {"name": "Intruder"}),
        "delete": ("delete", target, {}),
        "add": ("post", target + "items/", {"video_id": str(video.pk)}),
        "remove": ("delete", target + f"items/{video.pk}/", {}),
        "reorder": ("patch", target + "reorder/", {"video_ids": [str(video.pk)]}),
        "create": ("post", BASE, {"name": "Own collection"}),
        "like": ("post", f"/api/v1/videos/{video.pk}/like/", {}),
        "unlike": ("delete", f"/api/v1/videos/{video.pk}/like/", {}),
    }
    method, url, data = requests[operation]
    response = client.get(url) if method == "get" else send(client, method, url, data)
    private(response)
    if role in {"anonymous", "inactive"}:
        assert response.status_code == 401
    elif operation in {"list", "state"}:
        assert response.status_code == 200
        assert str(book.pk) not in response.content.decode()
        assert "Private owner name" not in response.content.decode()
    elif operation in {"create", "like", "unlike"}:
        assert response.status_code in {200, 201, 204}
        if operation == "create":
            assert Cookbook.objects.get(pk=response.json()["id"]).user == actor
    else:
        assert response.status_code == 404
    book.refresh_from_db()
    assert book.name == "Private owner name" and book.items.count() == 1


@pytest.mark.django_db
def test_csrf_origin_overposting_bounds_private_errors(browser, owner, video):
    path = create(browser)
    mutations = [
        ("post", BASE, {"name": "New"}),
        ("patch", path, {"name": "Rename"}),
        ("delete", path, {}),
        ("post", path + "items/", {"video_id": str(video.pk)}),
        ("delete", path + f"items/{video.pk}/", {}),
        ("patch", path + "reorder/", {"video_ids": []}),
        ("post", f"/api/v1/videos/{video.pk}/like/", {}),
        ("delete", f"/api/v1/videos/{video.pk}/like/", {}),
    ]
    for method, url, data in mutations:
        for extra in ({"HTTP_X_CSRFTOKEN": ""}, {"HTTP_ORIGIN": "https://foreign.invalid"}):
            response = send(browser, method, url, data, **extra)
            assert response.status_code == 403
            private(response)
        response = send(browser, method, url, {**data, "user": str(owner.pk)})
        assert response.status_code == 400
        private(response)
    for data in [
        [],
        {"name": ""},
        {"name": "x" * 151},
        {"name": 3},
        {"name": "Fine", "description": "x" * 2001},
        {"name": "x" * 17000},
    ]:
        assert send(browser, "post", BASE, data).status_code == 400
    assert browser.post(BASE, "{broken", content_type="application/json").status_code == 400
    for query in [
        "",
        "ids=",
        "ids=invalid",
        "ids=" + ",".join([str(video.pk)] * 101),
        f"ids={video.pk}&ids={video.pk}",
        f"ids={video.pk}&owner=x",
    ]:
        response = browser.get("/api/v1/me/video-state/?" + query)
        assert response.status_code == 400
        private(response)
    for url in [BASE + "invalid/", path + "absent/", f"/api/v1/me/video-state/?ids={video.pk}"]:
        response = browser.get(url, HTTP_IF_NONE_MATCH="*")
        private(response)
        assert response["Content-Type"].startswith("application/json")
    response = send(browser, "put", path)
    assert response.status_code == 405
    private(response)


@pytest.mark.django_db
@pytest.mark.parametrize("status", ["HIDDEN", "DRAFT"])
def test_hidden_redaction_republishing(browser, video, status, settings):
    settings.COOKBOOK_ITEM_LIMIT = 1
    path = create(browser)
    saved(browser, path, video)
    like = f"/api/v1/videos/{video.pk}/like/"
    assert send(browser, "post", like).status_code == 200
    Video.objects.filter(pk=video.pk).update(status=status)
    detail = browser.get(path).json()
    assert detail["cover"] is None and detail["count"] == 1
    entry = detail["items"][0]
    assert set(entry) == {"video_id", "position", "added_at", "state"}
    assert entry["state"] == "archive_unavailable"
    raw = browser.get(path).content.decode()
    for value in [
        video.recipe_name,
        video.slug,
        video.thumbnail_url,
        video.creator_name,
        video.canonical_url,
        video.external_id,
    ]:
        assert value not in raw
    assert browser.get(f"/api/v1/me/video-state/?ids={video.pk}").json()["results"] == {}
    assert send(browser, "post", like).status_code == 404
    assert send(browser, "post", path + "items/", {"video_id": str(video.pk)}).status_code == 404
    assert (
        send(browser, "post", path + "items/", {"video_id": str(make_video().pk)}).status_code
        == 409
    )
    assert send(browser, "delete", like).status_code == 204
    assert (
        send(browser, "patch", path + "reorder/", {"video_ids": [str(video.pk)]}).status_code == 200
    )
    Video.objects.filter(pk=video.pk).update(status="PUBLISHED")
    assert browser.get(path).json()["items"][0]["video"]["recipe_name"] == video.recipe_name
    assert send(browser, "delete", path + f"items/{video.pk}/").status_code == 204
    assert send(browser, "delete", f"/api/v1/videos/{uuid4()}/like/").status_code == 204


@pytest.mark.django_db
@pytest.mark.parametrize("mode", ["UNAVAILABLE", "EMBED_BLOCKED", "UNKNOWN", "expired"])
def test_source_unavailable_expiry_covers(browser, video, mode):
    path = create(browser)
    saved(browser, path, video)
    assert browser.get(path).json()["cover"]["thumbnail_url"] == video.thumbnail_url
    changes = (
        {"availability": mode}
        if mode != "expired"
        else {"last_metadata_sync_at": timezone.now() - timedelta(days=31)}
    )
    Video.objects.filter(pk=video.pk).update(**changes)
    detail = browser.get(path).json()
    assert detail["cover"] is None
    assert detail["items"][0]["state"] == "source_unavailable"
    data = detail["items"][0]["video"]
    assert data["recipe_name"] == video.recipe_name
    if mode == "expired":
        assert data["thumbnail_url"] is None and data["creator_name"] is None
        video.refresh_from_db()
        assert video.thumbnail_url == ""
    fallback = make_video()
    saved(browser, path, fallback)
    assert browser.get(path).json()["cover"]["thumbnail_url"] == fallback.thumbnail_url


@pytest.mark.django_db
def test_local_counts_public_cookie_free_etags_and_protection(browser, owner, video, settings):
    settings.VITE_DEV_SERVER = "http://localhost:5173"
    urls = ["/api/v1/videos/", f"/api/v1/videos/{video.slug}/", f"/shorts/{video.slug}"]
    old = {url: browser.get(url)["ETag"] for url in urls}
    for _ in range(2):
        response = send(browser, "post", f"/api/v1/videos/{video.pk}/like/")
        assert response.json() == {"liked": True, "like_count": 1}
    other = User.objects.create_user("phase6-other@example.invalid", PASSWORD)
    VideoLike.objects.create(user=other, video=video)
    for url in urls:
        response = browser.get(url, HTTP_IF_NONE_MATCH=old[url])
        assert response.status_code == 200 and response["ETag"] != old[url]
        assert not response.cookies and "Cookie" not in response.get("Vary", "")
        raw = response.content.decode()
        assert "cookbook_ids" not in raw and "liked" not in raw and owner.email not in raw
        assert browser.get(url, HTTP_IF_NONE_MATCH=response["ETag"]).status_code == 304
    assert browser.get(urls[1]).json()["like_count"] == 2
    for url in ["/api/v1/filters/", f"/api/v1/videos/{video.slug}/neighbors/"]:
        response = browser.get(url)
        assert not response.cookies and "Cookie" not in response.get("Vary", "")
    path = create(browser)
    saved(browser, path, video)
    with pytest.raises(ProtectedError):
        Collector(using="default").collect([video])
    assert send(browser, "delete", f"/api/v1/videos/{video.pk}/like/").status_code == 204
    assert browser.get(urls[1]).json()["like_count"] == 1


@pytest.mark.django_db
def test_deletion_cascades_rollback_and_preserves_other_activity(browser, owner, video):
    first, second = create(browser), create(browser)
    for path in (first, second):
        saved(browser, path, video)
    VideoLike.objects.create(user=owner, video=video)
    other = User.objects.create_user("phase6-survivor@example.invalid", PASSWORD)
    book = Cookbook.objects.create(user=other, name="Survives")
    CookbookItem.objects.create(cookbook=book, video=video, position=0)
    VideoLike.objects.create(user=other, video=video)
    public_path = f"/api/v1/videos/{video.slug}/"
    before = browser.get(public_path)
    assert before.json()["like_count"] == 2
    assert send(browser, "delete", "/api/v1/me/", {"password": "wrong"}).status_code == 400
    real_delete = User.delete

    def failing_delete(user, *args, **kwargs):
        real_delete(user, *args, **kwargs)
        raise RuntimeError("transaction failure")

    with patch.object(User, "delete", failing_delete), pytest.raises(RuntimeError):
        send(browser, "delete", "/api/v1/me/", {"password": PASSWORD})
    assert Cookbook.objects.filter(user=owner).count() == 2
    assert VideoLike.objects.filter(user=owner).count() == 1
    assert send(browser, "delete", "/api/v1/me/", {"password": PASSWORD}).status_code == 204
    assert not User.objects.filter(pk=owner.pk).exists()
    assert Cookbook.objects.count() == 1 and CookbookItem.objects.count() == 1
    assert VideoLike.objects.count() == 1 and Video.objects.filter(pk=video.pk).exists()
    assert browser.get(BASE).status_code == 401
    after = browser.get(public_path, HTTP_IF_NONE_MATCH=before["ETag"])
    assert after.status_code == 200 and after.json()["like_count"] == 1


@pytest.mark.django_db
def test_batched_queries_do_not_grow_per_item(browser, video):
    path = create(browser)
    saved(browser, path, video)
    with CaptureQueriesContext(connection) as first:
        browser.get(BASE)
    for _ in range(6):
        saved(browser, path, make_video())
    with CaptureQueriesContext(connection) as many:
        browser.get(BASE)
    assert len(first) == len(many)
    assert len(many) <= 11


@pytest.mark.django_db
def test_slashless_aliases_and_activity_rollback(browser, video):
    response = send(browser, "post", BASE.rstrip("/"), {"name": "Alias"})
    assert response.status_code == 201
    path = BASE + response.json()["id"] + "/"
    with patch("apps.cookbooks.views.touch", side_effect=RuntimeError("rollback")):
        with pytest.raises(RuntimeError):
            send(browser, "post", path + "items", {"video_id": str(video.pk)})
    assert not CookbookItem.objects.exists()
    saved(browser, path, video)
    other = make_video()
    saved(browser, path, other)
    original = list(CookbookItem.objects.values_list("video_id", "position"))
    with patch("apps.cookbooks.views.touch", side_effect=RuntimeError("rollback")):
        for method, url, data in [
            ("patch", path + "reorder", {"video_ids": [str(other.pk), str(video.pk)]}),
            ("delete", path + f"items/{video.pk}", {}),
        ]:
            with pytest.raises(RuntimeError):
                send(browser, method, url, data)
            assert list(CookbookItem.objects.values_list("video_id", "position")) == original
    response = send(browser, "post", f"/api/v1/videos/{video.pk}/like")
    assert response.status_code == 200
    private(response)
    for url in [path.rstrip("/"), f"/api/v1/me/video-state?ids={video.pk}"]:
        response = browser.get(url, HTTP_IF_NONE_MATCH="*")
        assert response.status_code == 200
        private(response)


@pytest.mark.django_db(transaction=True)
def test_database_uniqueness_constraints(owner, video):
    book = Cookbook.objects.create(user=owner, name="Constraints")
    VideoLike.objects.create(user=owner, video=video)
    with pytest.raises(IntegrityError), transaction.atomic():
        VideoLike.objects.create(user=owner, video=video)
    CookbookItem.objects.create(cookbook=book, video=video, position=0)
    with pytest.raises(IntegrityError), transaction.atomic():
        CookbookItem.objects.create(cookbook=book, video=video, position=1)
    with pytest.raises(IntegrityError), transaction.atomic():
        CookbookItem.objects.create(cookbook=book, video=make_video(), position=0)
    assert book.items.count() == 1


@pytest.mark.django_db
def test_large_configured_and_then_lowered_cap_can_reorder(browser, owner, settings):
    settings.COOKBOOK_ITEM_LIMIT = 500
    book = Cookbook.objects.create(user=owner, name="Larger configured cap")
    videos = [
        Video(external_id=f"large{i:06d}", slug=f"large-{i}", recipe_name=f"Recipe {i}")
        for i in range(500)
    ]
    Video.objects.bulk_create(videos)
    CookbookItem.objects.bulk_create(
        [
            CookbookItem(cookbook=book, video=video, position=index)
            for index, video in enumerate(videos)
        ]
    )
    path = BASE + f"{book.pk}/reorder/"
    ids = [str(video.pk) for video in reversed(videos)]
    assert send(browser, "patch", path, {"video_ids": ids}).status_code == 200
    settings.COOKBOOK_ITEM_LIMIT = 2
    assert send(browser, "patch", path, {"video_ids": list(reversed(ids))}).status_code == 200
    assert list(book.items.values_list("video_id", flat=True)) == [video.pk for video in videos]
    assert (
        send(browser, "patch", path, {"video_ids": ids, "padding": "x" * 30000}).status_code == 400
    )


def race(user, calls):
    """Each worker has its own PostgreSQL connection and browser session."""
    barrier = Barrier(len(calls))

    def worker(call):
        close_old_connections()
        try:
            client = Client()
            client.force_login(User.objects.get(pk=user.pk))
            barrier.wait(timeout=10)
            method, url, data = call
            return send(client, method, url, data).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=len(calls)) as executor:
        return list(executor.map(worker, calls))


@pytest.mark.django_db(transaction=True)
def test_postgresql_concurrent_caps_duplicates(owner, video, settings):
    assert connection.vendor == "postgresql"
    settings.COOKBOOK_OWNER_LIMIT = 1
    statuses = race(owner, [("post", BASE, {"name": "Race"})] * 2)
    assert sorted(statuses) == [201, 409]
    book = Cookbook.objects.get(user=owner)
    path = BASE + str(book.pk) + "/"
    settings.COOKBOOK_ITEM_LIMIT = 1
    another = make_video()
    statuses = race(
        owner, [("post", path + "items/", {"video_id": str(v.pk)}) for v in (video, another)]
    )
    assert sorted(statuses) == [200, 409] and book.items.count() == 1
    kept = book.items.get().video_id
    assert race(owner, [("post", path + "items/", {"video_id": str(kept)})] * 2) == [200, 200]
    assert race(owner, [("post", f"/api/v1/videos/{video.pk}/like/", {})] * 2) == [200, 200]
    assert VideoLike.objects.filter(user=owner, video=video).count() == 1
    assert list(book.items.values_list("position", flat=True)) == [0]


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("competing", ["add", "remove", "delete", "reorder"])
def test_postgresql_reorder_races(owner, video, competing):
    client = Client()
    client.force_login(owner)
    path = create(client)
    another = make_video()
    saved(client, path, video)
    saved(client, path, another)
    reorder = ("patch", path + "reorder/", {"video_ids": [str(another.pk), str(video.pk)]})
    calls = {
        "add": ("post", path + "items/", {"video_id": str(make_video().pk)}),
        "remove": ("delete", path + f"items/{video.pk}/", {}),
        "delete": ("delete", path, {}),
        "reorder": ("patch", path + "reorder/", {"video_ids": [str(video.pk), str(another.pk)]}),
    }
    statuses = race(owner, [reorder, calls[competing]])
    assert statuses[0] in {200, 404, 409}
    assert statuses[1] in {200, 204}
    items = list(CookbookItem.objects.order_by("position"))
    assert [row.position for row in items] == list(range(len(items)))
    assert len({row.video_id for row in items}) == len(items)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("operation", ["like", "save"])
def test_postgresql_publication_lock_rejects_waiting_writes(owner, video, operation):
    book = Cookbook.objects.create(user=owner, name="Race")
    client = Client()
    client.force_login(owner)
    url = f"/api/v1/videos/{video.pk}/like/" if operation == "like" else BASE + f"{book.pk}/items/"
    body = {} if operation == "like" else {"video_id": str(video.pk)}
    started = Event()

    def write():
        close_old_connections()
        try:
            started.set()
            return send(client, "post", url, body).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as executor:
        with transaction.atomic():
            Video.objects.select_for_update().get(pk=video.pk)
            Video.objects.filter(pk=video.pk).update(status="HIDDEN")
            future = executor.submit(write)
            assert started.wait(5)
        assert future.result(timeout=10) == 404
    assert not CookbookItem.objects.exists() and not VideoLike.objects.exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("operation", ["like", "save", "reorder"])
def test_postgresql_account_deletion_races(owner, video, operation):
    client = Client()
    client.force_login(owner)
    path = create(client)
    saved(client, path, video)
    calls = {
        "like": ("post", f"/api/v1/videos/{video.pk}/like/", {}),
        "save": ("post", path + "items/", {"video_id": str(video.pk)}),
        "reorder": ("patch", path + "reorder/", {"video_ids": [str(video.pk)]}),
    }
    statuses = race(owner, [("delete", "/api/v1/me/", {"password": PASSWORD}), calls[operation]])
    assert statuses[0] == 204 and statuses[1] in {200, 401}
    assert not User.objects.filter(pk=owner.pk).exists()
    assert not Cookbook.objects.exists() and not CookbookItem.objects.exists()
    assert not VideoLike.objects.exists() and Video.objects.filter(pk=video.pk).exists()
