from datetime import timedelta
from urllib.parse import urlparse

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from integrations.youtube import fetch_youtube_metadata, normalize_youtube_url

from .models import Video

SOURCE_DEFAULTS = {
    "source_title": "",
    "source_description": "",
    "creator_name": "",
    "creator_url": "",
    "thumbnail_url": "",
    "duration_seconds": None,
    "source_published_at": None,
    "embeddable": None,
    "provider_status": "",
}
SOURCE_FIELDS = tuple(SOURCE_DEFAULTS)
RETENTION = timedelta(days=30)
REFRESH_AGE = timedelta(days=25)


def require_permission(user, codename):
    if (
        not user.is_authenticated
        or not user.is_active
        or not user.is_staff
        or not user.has_perm(f"catalog.{codename}")
    ):
        raise PermissionDenied


def preview_source(url, user):
    require_permission(user, "add_video")
    video_id = normalize_youtube_url(url)
    existing = Video.objects.filter(platform="YOUTUBE", external_id=video_id).first()
    if existing:
        return {"existing": existing, "video_id": video_id}
    fetched_at = timezone.now()
    metadata = fetch_youtube_metadata(video_id)
    return {"existing": None, "video_id": video_id, "metadata": metadata, "fetched_at": fetched_at}


def safe_thumbnail(thumbnails):
    if not isinstance(thumbnails, dict):
        return ""
    for size in ("maxres", "standard", "high", "medium", "default"):
        thumbnail = thumbnails.get(size)
        if not isinstance(thumbnail, dict):
            continue
        url = thumbnail.get("url")
        if not isinstance(url, str) or len(url) > 1000:
            continue
        try:
            parsed = urlparse(url)
            if (
                parsed.scheme == "https"
                and parsed.hostname == "i.ytimg.com"
                and not (parsed.username or parsed.password or parsed.port)
            ):
                return url
        except ValueError:
            continue
    return ""


def source_values(metadata, video_id):
    if metadata.get("video_id") != video_id:
        raise ValidationError("Source identity changed. Preview again.")
    if not metadata.get("found"):
        return {**SOURCE_DEFAULTS, "availability": Video.Availability.UNAVAILABLE}
    published = metadata.get("published_at")
    try:
        published = parse_datetime(published) if isinstance(published, str) else None
    except ValueError:
        published = None
    if published and timezone.is_naive(published):
        published = None
    channel = metadata.get("channel_id", "")
    if (
        not isinstance(channel, str)
        or not channel.startswith("UC")
        or not channel.isascii()
        or not all(c.isalnum() or c in "_-" for c in channel)
    ):
        channel = ""
    duration = metadata.get("duration_seconds")
    if not isinstance(duration, int) or isinstance(duration, bool) or duration <= 0:
        duration = None
    embeddable = metadata.get("embeddable")
    availability = Video.Availability.UNKNOWN
    if embeddable is True:
        availability = Video.Availability.OK
    elif embeddable is False:
        availability = Video.Availability.EMBED_BLOCKED

    def text(key):
        value = metadata.get(key)
        return value if isinstance(value, str) else ""

    return {
        "source_title": text("title"),
        "source_description": text("description"),
        "creator_name": text("channel_title"),
        "creator_url": f"https://www.youtube.com/channel/{channel}" if channel else "",
        "thumbnail_url": safe_thumbnail(metadata.get("thumbnails")),
        "duration_seconds": duration,
        "source_published_at": published,
        "embeddable": embeddable if isinstance(embeddable, bool) else None,
        "provider_status": text("privacy_status")[:40],
        "availability": availability,
    }


def apply_source_snapshot(video, metadata, fetched_at):
    if fetched_at <= timezone.now() - RETENTION:
        raise ValidationError("Preview expired. Fetch the source again.")
    for field, value in source_values(metadata, video.external_id).items():
        setattr(video, field, value)
    video.last_metadata_sync_at = fetched_at
    video.last_availability_check_at = fetched_at
    video.last_sync_error = ""
    video.sync_failure_count = 0


def expired_query(now=None):
    return Q(last_metadata_sync_at__isnull=True) | Q(
        last_metadata_sync_at__lte=(now or timezone.now()) - RETENTION
    )


def purge_expired_source_metadata(queryset=None, now=None):
    queryset = queryset if queryset is not None else Video.objects.all()
    # Atomic SQL predicate protects a concurrent successful refresh from an old sweep.
    return (
        queryset.filter(expired_query(now))
        .exclude(**SOURCE_DEFAULTS, availability=Video.Availability.UNKNOWN)
        .update(**SOURCE_DEFAULTS, availability=Video.Availability.UNKNOWN)
    )


def read_source_metadata(video):
    """The single supported source-read boundary, used by admin and later public handlers.

    Always query current values: retained ORM instances must not resurrect expired snapshots.
    Raw source columns are persistence details, excluded from exports and admin forms/logs.
    """
    purge_expired_source_metadata(Video.objects.filter(pk=video.pk))
    current = Video.objects.values(*SOURCE_FIELDS, "availability", "last_metadata_sync_at").get(
        pk=video.pk
    )
    # Recheck after the query in case the deadline elapsed between statements.
    stamp = current["last_metadata_sync_at"]
    if stamp is None or stamp <= timezone.now() - RETENTION:
        return {
            **SOURCE_DEFAULTS,
            "availability": Video.Availability.UNKNOWN,
            "last_metadata_sync_at": stamp,
        }
    return current


def read_source_metadata_batch(video_ids):
    """Use the same purge/read/deadline boundary without a query per feed card."""
    videos = Video.objects.filter(pk__in=video_ids)
    purge_expired_source_metadata(videos)
    snapshots = {}
    for current in videos.values("id", *SOURCE_FIELDS, "availability", "last_metadata_sync_at"):
        stamp = current["last_metadata_sync_at"]
        if stamp is None or stamp <= timezone.now() - RETENTION:
            current = {
                "id": current["id"],
                **SOURCE_DEFAULTS,
                "availability": Video.Availability.UNKNOWN,
                "last_metadata_sync_at": stamp,
            }
        snapshots[current["id"]] = current
    return snapshots


def refresh_video(video_id, user=None):
    if user is not None:
        require_permission(user, "change_video")
        require_permission(user, "refresh_video")
    video = Video.objects.get(pk=video_id)
    fetched_at = timezone.now()
    from integrations.youtube import YouTubeAPIError

    try:
        metadata = fetch_youtube_metadata(video.external_id)
    except YouTubeAPIError as exc:
        Video.objects.filter(pk=video_id).update(
            last_sync_error=(
                f"provider_http_{exc.status_code}" if exc.status_code else "provider_failure"
            ),
            sync_failure_count=F("sync_failure_count") + 1,
        )
        purge_expired_source_metadata(Video.objects.filter(pk=video_id))
        return False
    return persist_refresh(video_id, metadata, fetched_at)


@transaction.atomic
def persist_refresh(video_id, metadata, fetched_at):
    video = Video.objects.select_for_update().get(pk=video_id)
    if video.last_metadata_sync_at and video.last_metadata_sync_at > fetched_at:
        return False
    if fetched_at <= timezone.now() - RETENTION:
        purge_expired_source_metadata(Video.objects.filter(pk=video_id))
        return False
    apply_source_snapshot(video, metadata, fetched_at)
    video.save(
        update_fields=(
            *SOURCE_FIELDS,
            "availability",
            "last_metadata_sync_at",
            "last_availability_check_at",
            "last_sync_error",
            "sync_failure_count",
        )
    )
    return True


@transaction.atomic
def publish_video(video_id, user):
    require_permission(user, "change_video")
    require_permission(user, "publish_video")
    video = Video.objects.select_for_update().get(pk=video_id)
    if not video.diet_reviewed or not video.air_fryer_confirmed:
        raise ValidationError("Confirm dietary review and air-fryer relevance before publishing.")
    video.status = Video.Status.PUBLISHED
    video.reviewed_by = user
    video.reviewed_at = timezone.now()
    video.full_clean()
    video.save(update_fields=("status", "reviewed_by", "reviewed_at", "updated_at"))
    return video


@transaction.atomic
def hide_video(video_id, user):
    require_permission(user, "change_video")
    require_permission(user, "hide_video")
    video = Video.objects.select_for_update().get(pk=video_id)
    video.status = Video.Status.HIDDEN
    video.save(update_fields=("status", "updated_at"))
    return video
