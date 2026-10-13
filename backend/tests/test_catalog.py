from datetime import timedelta
from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.urls import reverse
from django.utils import timezone

from apps.catalog.maintenance import expiry_due, maintenance_lock
from apps.catalog.models import EditorialPolicy, Video, VideoIngredient
from apps.catalog.services import (
    RETENTION,
    apply_source_snapshot,
    hide_video,
    persist_refresh,
    preview_source,
    publish_video,
    read_source_metadata,
    refresh_video,
    safe_thumbnail,
    source_values,
)
from apps.taxonomy.models import Cuisine, Ingredient, MealType
from integrations.youtube import YouTubeAPIError, fetch_youtube_metadata_batch

pytestmark = pytest.mark.django_db
VIDEO_ID = "uLIOVZNFlPE"
SOURCE_URL = f"https://www.youtube.com/shorts/{VIDEO_ID}"


@pytest.fixture
def admin_user():
    return get_user_model().objects.create_superuser(
        "curator@example.invalid", "test-only-password"
    )


@pytest.fixture
def staff_user():
    return get_user_model().objects.create_user("staff@example.invalid", is_staff=True)


@pytest.fixture
def video(admin_user):
    return Video.objects.create(
        external_id=VIDEO_ID, recipe_name="Crispy potatoes", added_by=admin_user
    )


@pytest.fixture
def metadata():
    return {
        "found": True,
        "video_id": VIDEO_ID,
        "title": "Original source title",
        "description": "Provider description",
        "channel_title": "Source creator",
        "channel_id": "UC1234",
        "duration_seconds": 124,
        "published_at": "2026-10-01T00:00:00Z",
        "thumbnails": {"high": {"url": f"https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg"}},
        "embeddable": True,
        "privacy_status": "public",
    }


def source_fixture(video, metadata, age=0):
    apply_source_snapshot(video, metadata, timezone.now())
    video.save()
    Video.objects.filter(pk=video.pk).update(
        last_metadata_sync_at=timezone.now() - timedelta(days=age)
    )
    video.refresh_from_db()


def grant(user, *permissions):
    user.user_permissions.add(
        *Permission.objects.filter(content_type__app_label="catalog", codename__in=permissions)
    )
    return get_user_model().objects.get(pk=user.pk)


def test_approved_policy_is_editable_and_seeded():
    policy = EditorialPolicy.objects.get(pk=1)
    assert "eggs" in policy.explanation and "NON_VEG" in policy.explanation
    assert "VEGAN" in policy.explanation and "UNKNOWN" in policy.explanation
    policy.explanation += " Editorial clarification."
    policy.save()
    assert EditorialPolicy.objects.get(pk=1).explanation.endswith("clarification.")


def test_video_constraints_and_unknown_defaults(video):
    assert video.diet == "UNKNOWN"
    assert video.difficulty is None and video.cook_time_minutes is None
    assert video.duration_seconds is None
    for values in (
        {"difficulty": 0},
        {"difficulty": 6},
        {"cook_time_minutes": 0},
        {"platform": "INSTAGRAM"},
        {"status": "PUBLISHED"},
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            Video.objects.filter(pk=video.pk).update(**values)


def test_duplicate_source_is_constrained_in_database(video):
    with pytest.raises(IntegrityError), transaction.atomic():
        Video.objects.create(external_id=VIDEO_ID, recipe_name="Another recipe")


def test_identity_is_immutable_in_model_and_database(video):
    original_slug = video.slug
    video.recipe_name = "Renamed potatoes"
    video.save()
    assert video.slug == original_slug
    for field, value in (
        ("slug", "replacement"),
        ("external_id", "jNQXAC9IVRw"),
        ("canonical_url", "https://www.youtube.com/watch?v=jNQXAC9IVRw"),
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            Video.objects.filter(pk=video.pk).update(**{field: value})
    video.external_id = "jNQXAC9IVRw"
    with pytest.raises(ValidationError):
        video.save()
    with pytest.raises(ProtectedError):
        Video.objects.filter(pk=video.pk).delete()


@pytest.mark.parametrize("model", [Cuisine, Ingredient, MealType])
def test_aliases_resolve_to_canonical_entries(model):
    canonical = model.objects.create(name="Potato")
    alias = model.objects.create(name="Aloo", canonical=canonical)
    assert model.resolve("  ALOO ") == canonical
    assert model.resolve("POTATO") == canonical
    with pytest.raises(ValidationError):
        model.objects.create(name="potato")
    with pytest.raises(ValidationError):
        model.objects.create(name="Batata", canonical=alias)
    canonical.name = "Potatoes"
    slug = canonical.slug
    canonical.save()
    assert canonical.slug == slug


def test_ingredient_uniqueness_and_primary_flag(video):
    ingredient = Ingredient.objects.create(name="Potato")
    VideoIngredient.objects.create(video=video, ingredient=ingredient, is_primary=True)
    with pytest.raises(IntegrityError), transaction.atomic():
        VideoIngredient.objects.create(video=video, ingredient=ingredient)
    assert video.ingredient_links.get().is_primary


def test_staff_alone_cannot_preview_publish_hide_or_refresh(video, staff_user):
    for service, argument in (
        (preview_source, SOURCE_URL),
        (publish_video, video.pk),
        (hide_video, video.pk),
        (refresh_video, video.pk),
    ):
        with pytest.raises(PermissionDenied):
            service(argument, staff_user)


def test_model_change_permission_is_not_publish_permission(video, staff_user):
    staff_user = grant(staff_user, "change_video")
    with pytest.raises(PermissionDenied):
        publish_video(video.pk, staff_user)


def test_duplicate_preview_skips_provider_for_every_status(video, admin_user):
    with patch("apps.catalog.services.fetch_youtube_metadata") as fetch:
        for status in ("DRAFT", "HIDDEN", "PUBLISHED"):
            Video.objects.filter(pk=video.pk).update(
                status=status,
                diet_reviewed=True,
                air_fryer_confirmed=True,
                reviewed_at=timezone.now(),
            )
            result = preview_source(SOURCE_URL, admin_user)
            assert result["existing"].pk == video.pk
        fetch.assert_not_called()


def test_publication_is_independent_of_source_availability(video, admin_user):
    with pytest.raises(ValidationError):
        publish_video(video.pk, admin_user)
    video.diet_reviewed = True
    video.air_fryer_confirmed = True
    video.availability = Video.Availability.UNAVAILABLE
    video.save()
    result = publish_video(video.pk, admin_user)
    assert result.status == "PUBLISHED" and result.availability == "UNAVAILABLE"
    assert result.reviewed_by == admin_user and result.reviewed_at
    slug = result.slug
    hide_video(video.pk, admin_user)
    assert publish_video(video.pk, admin_user).slug == slug


def test_deleting_admin_keeps_catalog_and_clears_attribution(video, admin_user):
    video.diet_reviewed = video.air_fryer_confirmed = True
    video.save()
    publish_video(video.pk, admin_user)
    admin_user.delete()
    video.refresh_from_db()
    assert video.added_by is None and video.reviewed_by is None and video.status == "PUBLISHED"


def test_refresh_changes_only_source_fields(video, admin_user, metadata):
    ingredient = Ingredient.objects.create(name="Potato")
    VideoIngredient.objects.create(video=video, ingredient=ingredient, is_primary=True)
    video.diet_reviewed = video.air_fryer_confirmed = True
    video.recipe_summary = "Independently curated explanation"
    video.cook_time_minutes = 20
    video.diet = "VEG"
    video.save()
    publish_video(video.pk, admin_user)
    before = Video.objects.values().get(pk=video.pk)
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=metadata):
        assert refresh_video(video.pk, admin_user)
    video.refresh_from_db()
    for field in (
        "recipe_name",
        "recipe_summary",
        "cook_time_minutes",
        "diet",
        "status",
        "slug",
        "reviewed_by_id",
        "reviewed_at",
    ):
        assert getattr(video, field) == before[field]
    assert video.source_title == metadata["title"]
    assert video.ingredient_links.get().is_primary


@pytest.mark.parametrize("age", [30, 31, 60])
def test_expiry_guards_stale_instances_and_keeps_editorial_data(video, metadata, age):
    source_fixture(video, metadata, age)
    assert video.source_title  # Old instance intentionally retains a stale snapshot.
    current = read_source_metadata(video)
    assert current["source_title"] == "" and current["thumbnail_url"] == ""
    assert current["availability"] == "UNKNOWN"
    video.refresh_from_db()
    assert video.source_title == "" and video.creator_name == ""
    assert video.recipe_name == "Crispy potatoes"
    assert expiry_due() == 0  # Idempotent after the read purge.


def test_current_source_is_readable(video, metadata):
    source_fixture(video, metadata, 29)
    assert read_source_metadata(video)["source_title"] == metadata["title"]


def test_failed_refresh_does_not_extend_retention_or_hide(video, admin_user, metadata):
    source_fixture(video, metadata, 31)
    video.diet_reviewed = video.air_fryer_confirmed = True
    video.save()
    publish_video(video.pk, admin_user)
    old_stamp = video.last_metadata_sync_at
    with patch(
        "apps.catalog.services.fetch_youtube_metadata",
        side_effect=YouTubeAPIError("temporary", 503),
    ):
        assert refresh_video(video.pk, admin_user) is False
    video.refresh_from_db()
    assert video.last_metadata_sync_at == old_stamp
    assert video.source_title == "" and video.status == "PUBLISHED"
    assert video.last_sync_error == "provider_http_503" and video.sync_failure_count == 1


def test_old_refresh_cannot_overwrite_newer_snapshot(video, metadata):
    now = timezone.now()
    assert persist_refresh(video.pk, metadata, now)
    older = {**metadata, "title": "Old response"}
    assert persist_refresh(video.pk, older, now - timedelta(seconds=1)) is False
    video.refresh_from_db()
    assert video.source_title == metadata["title"]
    assert persist_refresh(video.pk, older, now - RETENTION) is False


def test_retention_timestamp_is_original_not_save_time(video, metadata):
    fetched_at = timezone.now() - timedelta(days=2)
    apply_source_snapshot(video, metadata, fetched_at)
    assert video.last_metadata_sync_at == fetched_at
    with pytest.raises(ValidationError):
        apply_source_snapshot(video, metadata, timezone.now() - RETENTION)


def test_batch_request_and_missing_identity_result(metadata):
    import httpx

    client = Mock(spec=httpx.Client)
    response = Mock(spec=httpx.Response)
    response.status_code = 200
    response.json.return_value = {"items": [{"id": VIDEO_ID, "status": {"embeddable": False}}]}
    client.get.return_value = response
    results = fetch_youtube_metadata_batch(
        [VIDEO_ID, "jNQXAC9IVRw"], api_key="mock-key", client=client
    )
    assert results[VIDEO_ID]["embeddable"] is False
    assert results["jNQXAC9IVRw"]["found"] is False
    assert client.get.call_args.kwargs["params"]["id"] == f"{VIDEO_ID},jNQXAC9IVRw"


def test_daily_refresh_targets_all_publication_states_and_batches(admin_user, metadata):
    ids = []
    for index, status in enumerate(("DRAFT", "HIDDEN", "PUBLISHED")):
        source_id = f"{index:011d}"
        video = Video.objects.create(
            external_id=source_id,
            recipe_name="Recipe",
            status=status,
            diet_reviewed=True,
            air_fryer_confirmed=True,
            reviewed_at=timezone.now(),
            added_by=admin_user,
        )
        Video.objects.filter(pk=video.pk).update(
            last_metadata_sync_at=timezone.now() - timedelta(days=25)
        )
        ids.append(source_id)

    def respond(request_ids):
        return {source_id: {**metadata, "video_id": source_id} for source_id in request_ids}

    with patch(
        "apps.catalog.maintenance.fetch_youtube_metadata_batch", side_effect=respond
    ) as fetch:
        output = StringIO()
        call_command("refresh_youtube_metadata", stdout=output)
        assert fetch.call_count == 1
        assert set(fetch.call_args.args[0]) == set(ids)
    assert '"refreshed": 3' in output.getvalue()


def test_outage_expiry_command_runs_and_preserves_publication(video, metadata):
    source_fixture(video, metadata, 31)
    with patch(
        "apps.catalog.maintenance.fetch_youtube_metadata_batch",
        side_effect=YouTubeAPIError("quota", 403),
    ) as fetch:
        with pytest.raises(CommandError, match="provider_http_403"):
            call_command("refresh_youtube_metadata", stdout=StringIO())
        assert fetch.call_count == 1
    call_command("purge_expired_source_metadata", stdout=StringIO())
    video.refresh_from_db()
    assert video.source_title == "" and video.status == "DRAFT"


def test_admin_permissions_csrf_and_cache_headers(client, staff_user):
    url = reverse("admin:catalog_video_preview")
    assert client.get(url).status_code == 302
    client.force_login(staff_user)
    denied = client.post(url, {"source_url": SOURCE_URL})
    assert denied.status_code == 403
    assert (
        "private" in denied.headers["Cache-Control"]
        and "no-store" in denied.headers["Cache-Control"]
    )
    staff_user = grant(staff_user, "add_video")
    from django.test import Client

    strict = Client(enforce_csrf_checks=True)
    strict.force_login(staff_user)
    assert strict.post(url, {"source_url": SOURCE_URL}).status_code == 403


def test_admin_preview_uses_approved_embed_and_sanitized_output(client, admin_user, metadata):
    client.force_login(admin_user)
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=metadata):
        response = client.post(reverse("admin:catalog_video_preview"), {"source_url": SOURCE_URL})
    assert response.status_code == 200
    html = response.content.decode()
    assert "youtube-nocookie.com/embed/" in html
    assert "strict-origin-when-cross-origin" in html
    assert "error 153" in html and "Recipe cooking time" in html
    assert "no-store" in response.headers["Cache-Control"]


def draft_post():
    return {
        "source_url": SOURCE_URL,
        "recipe_name": "Curated potatoes",
        "recipe_summary": "Hand written",
        "diet": "VEG",
        "language": "en",
        "diet_reviewed": "on",
        "air_fryer_confirmed": "on",
        "ingredient_links-TOTAL_FORMS": "1",
        "ingredient_links-INITIAL_FORMS": "0",
        "ingredient_links-MIN_NUM_FORMS": "0",
        "ingredient_links-MAX_NUM_FORMS": "1000",
        "_save": "Save",
    }


def test_admin_add_revalidates_source_and_ignores_forged_status(client, admin_user, metadata):
    client.force_login(admin_user)
    payload = {
        **draft_post(),
        "source_title": "Forged source",
        "status": "PUBLISHED",
        "external_id": "jNQXAC9IVRw",
    }
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=metadata) as fetch:
        response = client.post(reverse("admin:catalog_video_add"), payload)
    assert response.status_code == 302
    fetch.assert_called_once_with(VIDEO_ID)
    video = Video.objects.get(external_id=VIDEO_ID)
    assert video.status == "DRAFT" and video.source_title == metadata["title"]
    assert video.added_by == admin_user
    log = LogEntry.objects.get(object_id=str(video.pk))
    assert metadata["title"] not in log.change_message
    assert metadata["title"] not in log.object_repr


def test_preview_does_not_retain_provider_payload_in_session(client, admin_user, metadata):
    client.force_login(admin_user)
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=metadata):
        client.post(reverse("admin:catalog_video_preview"), {"source_url": SOURCE_URL})
    assert metadata["title"] not in str(dict(client.session))
    assert not Video.objects.exists()


def test_admin_change_cannot_restore_stale_source_or_bypass_review(
    client, admin_user, video, metadata
):
    source_fixture(video, metadata, 31)
    video.diet_reviewed = video.air_fryer_confirmed = True
    video.save()
    publish_video(video.pk, admin_user)
    client.force_login(admin_user)
    payload = {**draft_post(), "recipe_name": "Changed curated potatoes", "status": "PUBLISHED"}
    response = client.post(reverse("admin:catalog_video_change", args=(video.pk,)), payload)
    assert response.status_code == 302
    video.refresh_from_db()
    assert video.status == "DRAFT" and video.reviewed_at is None
    assert read_source_metadata(video)["source_title"] == ""


def test_no_public_catalog_endpoints_in_phase_two(client, video):
    assert client.get(f"/api/v1/videos/{video.slug}/").status_code == 404
    assert client.get(f"/shorts/{video.slug}").status_code == 404


@pytest.mark.django_db(transaction=True)
def test_concurrent_duplicate_inserts_create_one_record():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections

    barrier = Barrier(2)

    def insert():
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            with transaction.atomic():
                Video.objects.create(external_id=VIDEO_ID, recipe_name="Concurrent recipe")
            return "created"
        except IntegrityError:
            return "duplicate"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: insert(), range(2)))
    assert sorted(results) == ["created", "duplicate"]
    assert Video.objects.filter(external_id=VIDEO_ID).count() == 1


@pytest.mark.django_db(transaction=True)
def test_overlap_lock_rejects_second_connection():
    import psycopg
    from django.db import connection

    params = connection.get_connection_params()
    # Django-specific driver options are unnecessary on a raw test connection.
    params.pop("cursor_factory", None)
    params.pop("context", None)
    with maintenance_lock(), psycopg.connect(**params) as other:
        with other.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_lock(%s)", [73492011])
            assert cursor.fetchone()[0] is False


def test_manual_refresh_does_not_count_as_success_when_snapshot_loses_race(video, metadata):
    source_fixture(video, metadata)
    with (
        patch("apps.catalog.services.fetch_youtube_metadata", return_value=metadata),
        patch("apps.catalog.services.persist_refresh", return_value=False),
    ):
        assert refresh_video(video.pk) is False


def test_refresh_budget_and_retry_bounds(video, metadata):
    with (
        patch(
            "apps.catalog.maintenance.fetch_youtube_metadata_batch",
            side_effect=YouTubeAPIError("server", 503),
        ) as fetch,
        patch("apps.catalog.maintenance.sleep") as sleep,
    ):
        with pytest.raises(CommandError, match="Source refresh failed"):
            call_command("refresh_youtube_metadata", retries=2, stdout=StringIO())
        assert fetch.call_count == 3
        assert [call.args[0] for call in sleep.call_args_list] == [1, 2]
    for options in ({"batch_size": 51}, {"max_requests": 101}, {"retries": 3}):
        with pytest.raises(CommandError):
            call_command("refresh_youtube_metadata", **options)


def test_admin_edit_cannot_clobber_newly_refreshed_source(video, metadata, admin_user):
    from django.contrib.admin import site
    from django.test import RequestFactory

    source_fixture(video, metadata)
    stale = Video.objects.get(pk=video.pk)
    assert persist_refresh(video.pk, {**metadata, "title": "Newer source title"}, timezone.now())
    stale.recipe_name = "New editorial name"
    request = RequestFactory().post("/django-admin/")
    request.user = admin_user
    form = Mock(changed_data=["recipe_name"])
    site._registry[Video].save_model(request, stale, form, change=True)
    video.refresh_from_db()
    assert video.source_title == "Newer source title"
    assert video.recipe_name == "New editorial name"


def test_expiry_keeps_newer_refresh(video, metadata):
    source_fixture(video, metadata, 31)
    assert persist_refresh(video.pk, metadata, timezone.now())
    assert expiry_due() == 0
    assert read_source_metadata(video)["source_title"] == metadata["title"]


def test_language_validation(video):
    video.language = "zz"
    with pytest.raises(ValidationError):
        video.full_clean()
    for language in ("en", "hi", "bn", ""):
        video.language = language
        video.full_clean()


def test_alias_used_by_recipe_cannot_become_another_alias(video):
    ingredient = Ingredient.objects.create(name="Potato")
    other = Ingredient.objects.create(name="Paneer")
    VideoIngredient.objects.create(video=video, ingredient=ingredient)
    ingredient.canonical = other
    with pytest.raises(ValidationError):
        ingredient.save()


def test_bad_provider_optional_fields_remain_unknown(metadata):
    malformed = {**metadata, "published_at": "2026-99-99T00:00:00Z", "duration_seconds": 0}
    values = source_values(malformed, VIDEO_ID)
    assert values["source_published_at"] is None
    assert values["duration_seconds"] is None
    assert safe_thumbnail({"high": {"url": "https://[invalid"}}) == ""
    assert safe_thumbnail({"high": {"url": "https://i.ytimg.com:invalid/image.jpg"}}) == ""
    assert safe_thumbnail({"high": {"url": "https://attacker.example/image.jpg"}}) == ""


@pytest.mark.parametrize("microseconds", [-1, 0, 1])
def test_exact_retention_boundary(video, metadata, microseconds):
    source_fixture(video, metadata)
    now = timezone.now()
    Video.objects.filter(pk=video.pk).update(
        last_metadata_sync_at=now - RETENTION + timedelta(microseconds=microseconds)
    )
    with patch("apps.catalog.services.timezone.now", return_value=now):
        result = read_source_metadata(video)
    assert bool(result["source_title"]) is (microseconds > 0)


def test_staff_without_model_permissions_cannot_mutate_admin_paths(client, staff_user, video):
    client.force_login(staff_user)
    for url, data in (
        (reverse("admin:catalog_video_add"), draft_post()),
        (reverse("admin:catalog_video_change", args=(video.pk,)), draft_post()),
        (
            reverse("admin:catalog_video_changelist"),
            {"action": "review_and_publish", "_selected_action": str(video.pk)},
        ),
        (reverse("admin:taxonomy_ingredient_add"), {"name": "Potato"}),
        (reverse("admin:taxonomy_cuisine_add"), {"name": "Indian"}),
        (reverse("admin:taxonomy_mealtype_add"), {"name": "Snack"}),
    ):
        response = client.post(url, data)
        assert response.status_code == 403
        assert "no-store" in response.headers["Cache-Control"]
    assert not Ingredient.objects.exists()
    video.refresh_from_db()
    assert video.status == "DRAFT"


def test_slug_collision_is_rejected_by_database(video):
    with pytest.raises(IntegrityError), transaction.atomic():
        Video.objects.create(external_id="jNQXAC9IVRw", recipe_name="Another", slug=video.slug)


def test_duplicate_preview_does_not_leak_source_to_add_only_staff(
    client, video, metadata, staff_user
):
    source_fixture(video, metadata)
    staff_user = grant(staff_user, "add_video")
    client.force_login(staff_user)
    response = client.post(reverse("admin:catalog_video_preview"), {"source_url": SOURCE_URL})
    assert response.status_code == 200
    assert "already in the archive" in response.content.decode()
    assert metadata["title"] not in response.content.decode()
    assert "Open existing record" not in response.content.decode()


@pytest.mark.django_db(transaction=True)
def test_concurrent_refresh_responses_leave_latest_snapshot(video, metadata):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections

    barrier = Barrier(2)
    now = timezone.now()

    def store(index):
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return persist_refresh(
                video.pk,
                {**metadata, "title": "Latest" if index else "Older"},
                now if index else now - timedelta(seconds=1),
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(store, range(2)))
    video.refresh_from_db()
    assert video.source_title == "Latest" and video.recipe_name == "Crispy potatoes"


@pytest.mark.parametrize(
    ("provider_result", "expected"),
    [
        ({"found": False, "video_id": VIDEO_ID}, Video.Availability.UNAVAILABLE),
        (
            {"found": True, "video_id": VIDEO_ID, "embeddable": False},
            Video.Availability.EMBED_BLOCKED,
        ),
    ],
)
def test_refresh_persists_distinct_unavailable_and_embed_blocked_states(
    video, metadata, provider_result, expected
):
    source_fixture(video, metadata)
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=provider_result):
        assert refresh_video(video.pk) is True
    video.refresh_from_db()
    assert video.availability == expected
    assert read_source_metadata(video)["availability"] == expected
    assert video.recipe_name == "Crispy potatoes"
    assert video.status == Video.Status.DRAFT


def test_invalid_bulk_publish_and_refresh_report_errors_without_mutation(
    client, admin_user, video
):
    client.force_login(admin_user)
    url = reverse("admin:catalog_video_changelist")
    selection = {"_selected_action": str(video.pk), "index": "0"}
    response = client.post(url, {**selection, "action": "review_and_publish"}, follow=True)
    assert response.status_code == 200
    assert "Confirm dietary review" in response.content.decode()
    video.refresh_from_db()
    assert video.status == Video.Status.DRAFT
    with patch(
        "apps.catalog.services.fetch_youtube_metadata",
        side_effect=YouTubeAPIError("provider unavailable", 503),
    ):
        response = client.post(url, {**selection, "action": "refresh_selected"}, follow=True)
    assert response.status_code == 200
    assert "Source refresh failed" in response.content.decode()
    video.refresh_from_db()
    assert video.availability == Video.Availability.UNKNOWN
    assert video.status == Video.Status.DRAFT


def test_inactive_staff_cannot_use_admin_preview_or_actions(client, staff_user, video):
    staff_user = grant(
        staff_user, "add_video", "change_video", "publish_video", "hide_video", "refresh_video"
    )
    staff_user.is_active = False
    staff_user.save(update_fields=("is_active",))
    client.force_login(staff_user)
    preview = client.post(reverse("admin:catalog_video_preview"), {"source_url": SOURCE_URL})
    assert preview.status_code in (302, 403)
    action = client.post(
        reverse("admin:catalog_video_changelist"),
        {"action": "hide_selected", "_selected_action": str(video.pk)},
    )
    assert action.status_code in (302, 403)
    video.refresh_from_db()
    assert video.status == Video.Status.DRAFT


def test_duplicate_insert_rolls_back_taxonomy_relations(video):
    ingredient = Ingredient.objects.create(name="Potato")
    with pytest.raises(IntegrityError), transaction.atomic():
        candidate = Video.objects.create(
            external_id="jNQXAC9IVRw", recipe_name="Temporary recipe"
        )
        VideoIngredient.objects.create(video=candidate, ingredient=ingredient)
        Video.objects.filter(pk=candidate.pk).update(external_id=VIDEO_ID)
    assert not Video.objects.filter(external_id="jNQXAC9IVRw").exists()
    assert not VideoIngredient.objects.filter(ingredient=ingredient).exists()
    assert Video.objects.filter(external_id=VIDEO_ID).count() == 1


@pytest.mark.parametrize("action", ["review_and_publish", "hide_selected", "refresh_selected"])
def test_staff_without_action_permission_cannot_run_bulk_action(
    client, staff_user, video, action
):
    staff_user = grant(staff_user, "change_video")
    client.force_login(staff_user)
    response = client.post(
        reverse("admin:catalog_video_changelist"),
        {"action": action, "_selected_action": str(video.pk)},
    )
    assert response.status_code == 200
    assert response.context["action_form"] is None
    video.refresh_from_db()
    assert video.status == Video.Status.DRAFT


@pytest.mark.parametrize("role", ["anonymous", "non_staff", "inactive", "unprivileged_staff"])
def test_admin_mutation_matrix_denies_unapproved_roles(
    client, admin_user, video, role
):
    if role != "anonymous":
        user = get_user_model().objects.create_user(
            f"{role}@example.invalid", is_staff=role != "non_staff"
        )
        if role == "inactive":
            user.is_active = False
            user.save(update_fields=("is_active",))
        client.force_login(user)
    paths = (
        (reverse("admin:catalog_video_preview"), {"source_url": SOURCE_URL}),
        (reverse("admin:catalog_video_add"), draft_post()),
        (reverse("admin:catalog_video_change", args=(video.pk,)), draft_post()),
        (reverse("admin:taxonomy_ingredient_add"), {"name": "Potato"}),
        (reverse("admin:taxonomy_cuisine_add"), {"name": "Indian"}),
        (reverse("admin:taxonomy_mealtype_add"), {"name": "Snack"}),
    )
    with patch("apps.catalog.services.fetch_youtube_metadata") as fetch:
        for path, payload in paths:
            response = client.post(path, payload)
            assert response.status_code in (302, 403)
            assert "no-store" in response.headers["Cache-Control"]
        for action in ("review_and_publish", "hide_selected", "refresh_selected"):
            response = client.post(
                reverse("admin:catalog_video_changelist"),
                {"action": action, "_selected_action": str(video.pk)},
            )
            assert response.status_code in (302, 403)
            assert "no-store" in response.headers["Cache-Control"]
    fetch.assert_not_called()
    video.refresh_from_db()
    assert video.status == Video.Status.DRAFT
    assert not Ingredient.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_refresh_overlapping_expiry_and_editorial_edit_preserves_both(video, metadata):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections

    source_fixture(video, metadata, 31)
    fetched = Event()
    release = Event()

    def delayed_fetch(_video_id):
        fetched.set()
        assert release.wait(timeout=5)
        return {**metadata, "title": "Fresh source"}

    def refresh_in_other_connection():
        close_old_connections()
        try:
            with patch("apps.catalog.services.fetch_youtube_metadata", side_effect=delayed_fetch):
                return refresh_video(video.pk)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(refresh_in_other_connection)
        assert fetched.wait(timeout=5)
        try:
            Video.objects.filter(pk=video.pk).update(recipe_name="Edited while fetching")
            assert expiry_due() == 1
        finally:
            release.set()
        assert future.result(timeout=5) is True
    video.refresh_from_db()
    assert video.recipe_name == "Edited while fetching"
    assert video.source_title == "Fresh source"
    assert video.availability == Video.Availability.OK


def test_csrf_blocks_all_admin_mutation_paths(admin_user, video):
    from django.test import Client

    strict = Client(enforce_csrf_checks=True)
    strict.force_login(admin_user)
    paths = (
        (reverse("admin:catalog_video_preview"), {"source_url": SOURCE_URL}),
        (reverse("admin:catalog_video_add"), draft_post()),
        (reverse("admin:catalog_video_change", args=(video.pk,)), draft_post()),
        (reverse("admin:taxonomy_ingredient_add"), {"name": "Potato"}),
        (reverse("admin:taxonomy_cuisine_add"), {"name": "Indian"}),
        (reverse("admin:taxonomy_mealtype_add"), {"name": "Snack"}),
    )
    with patch("apps.catalog.services.fetch_youtube_metadata") as fetch:
        for path, payload in paths:
            response = strict.post(path, payload)
            assert response.status_code == 403
            assert "no-store" in response.headers["Cache-Control"]
        for action in ("review_and_publish", "hide_selected", "refresh_selected"):
            response = strict.post(
                reverse("admin:catalog_video_changelist"),
                {"action": action, "_selected_action": str(video.pk)},
            )
            assert response.status_code == 403
            assert "no-store" in response.headers["Cache-Control"]
    fetch.assert_not_called()
    video.refresh_from_db()
    assert video.status == Video.Status.DRAFT
    assert not Ingredient.objects.exists()


def test_mocked_admin_curation_round_trip_preserves_slug_and_editorial_data(
    client, admin_user, metadata
):
    ingredient = Ingredient.objects.create(name="Potato")
    cuisine = Cuisine.objects.create(name="Indian")
    meal_type = MealType.objects.create(name="Snack")
    client.force_login(admin_user)
    payload = {
        **draft_post(),
        "cuisines": [str(cuisine.pk)],
        "meal_types": [str(meal_type.pk)],
        "ingredient_links-0-ingredient": str(ingredient.pk),
        "ingredient_links-0-is_primary": "on",
    }
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=metadata):
        response = client.post(reverse("admin:catalog_video_add"), payload)
    assert response.status_code == 302
    curated = Video.objects.get(external_id=VIDEO_ID)
    slug = curated.slug
    assert curated.status == Video.Status.DRAFT
    assert curated.ingredients.filter(pk=ingredient.pk).exists()
    assert curated.cuisines.filter(pk=cuisine.pk).exists()
    assert curated.meal_types.filter(pk=meal_type.pk).exists()

    list_url = reverse("admin:catalog_video_changelist")
    selection = {"_selected_action": str(curated.pk), "index": "0"}
    assert client.post(list_url, {**selection, "action": "review_and_publish"}).status_code == 302
    curated.refresh_from_db()
    assert curated.status == Video.Status.PUBLISHED
    assert curated.reviewed_by == admin_user

    link = VideoIngredient.objects.get(video=curated, ingredient=ingredient)
    changed = {
        **payload,
        "recipe_name": "Renamed curated potatoes",
        "ingredient_links-INITIAL_FORMS": "1",
        "ingredient_links-0-id": str(link.pk),
    }
    change_response = client.post(
        reverse("admin:catalog_video_change", args=(curated.pk,)), changed
    )
    assert change_response.status_code == 302
    curated.refresh_from_db()
    assert curated.slug == slug
    assert curated.status == Video.Status.DRAFT
    assert curated.recipe_name == "Renamed curated potatoes"
    assert client.post(list_url, {**selection, "action": "review_and_publish"}).status_code == 302
    assert client.post(list_url, {**selection, "action": "hide_selected"}).status_code == 302
    curated.refresh_from_db()
    assert curated.status == Video.Status.HIDDEN
    assert client.post(list_url, {**selection, "action": "review_and_publish"}).status_code == 302
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=metadata):
        assert client.post(list_url, {**selection, "action": "refresh_selected"}).status_code == 302
    curated.refresh_from_db()
    assert curated.status == Video.Status.PUBLISHED
    assert curated.slug == slug
    assert curated.recipe_name == "Renamed curated potatoes"
    assert curated.ingredients.filter(pk=ingredient.pk).exists()


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ({"found": False, "video_id": VIDEO_ID}, "The source was not returned"),
        ({"found": True, "video_id": VIDEO_ID, "embeddable": False}, "Embedding is disabled"),
    ],
)
def test_admin_preview_explains_confirmed_source_failure(
    client, admin_user, source, expected
):
    client.force_login(admin_user)
    with patch("apps.catalog.services.fetch_youtube_metadata", return_value=source):
        response = client.post(reverse("admin:catalog_video_preview"), {"source_url": SOURCE_URL})
    assert response.status_code == 200
    assert expected in response.content.decode()
    assert not Video.objects.exists()


def test_admin_preview_handles_invalid_url_and_temporary_provider_failure(client, admin_user):
    client.force_login(admin_user)
    url = reverse("admin:catalog_video_preview")
    with patch("apps.catalog.services.fetch_youtube_metadata") as fetch:
        invalid = client.post(url, {"source_url": "https://example.invalid/video"})
    assert invalid.status_code == 200
    assert "source_url" in invalid.context["form"].errors
    fetch.assert_not_called()
    with patch(
        "apps.catalog.services.fetch_youtube_metadata",
        side_effect=YouTubeAPIError("Temporary provider failure", 503),
    ):
        temporary = client.post(url, {"source_url": SOURCE_URL})
    assert temporary.status_code == 200
    assert "Temporary provider failure" in temporary.content.decode()
    assert not Video.objects.exists()


def test_admin_uniqueness_race_redirects_without_partial_relations(
    client, admin_user, video, metadata
):
    ingredient = Ingredient.objects.create(name="Potato")
    client.force_login(admin_user)
    payload = {
        **draft_post(),
        "ingredient_links-0-ingredient": str(ingredient.pk),
        "ingredient_links-0-is_primary": "on",
    }
    # Simulate another curator committing this identity after the form's duplicate check.
    stale_preview = {
        "existing": None,
        "video_id": VIDEO_ID,
        "metadata": metadata,
        "fetched_at": timezone.now(),
    }
    with patch("apps.catalog.forms.preview_source", return_value=stale_preview):
        response = client.post(reverse("admin:catalog_video_add"), payload)
    assert response.status_code == 302
    assert response.url == reverse("admin:catalog_video_change", args=(video.pk,))
    assert Video.objects.filter(external_id=VIDEO_ID).count() == 1
    assert not VideoIngredient.objects.filter(ingredient=ingredient).exists()
