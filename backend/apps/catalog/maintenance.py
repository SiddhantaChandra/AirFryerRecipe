from contextlib import contextmanager
from time import sleep

from django.core.management.base import CommandError
from django.db import connection
from django.db.models import F, Q
from django.utils import timezone

from integrations.youtube import YouTubeAPIError, fetch_youtube_metadata_batch

from .models import Video
from .services import REFRESH_AGE, SOURCE_DEFAULTS, persist_refresh, purge_expired_source_metadata


@contextmanager
def maintenance_lock():
    """Session advisory lock released on normal exit or database connection loss."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [73492011])
        acquired = cursor.fetchone()[0]
    if not acquired:
        raise CommandError("Another catalog maintenance command is running. Try again later.")
    try:
        yield
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(%s)", [73492011])


def refresh_due(batch_size=50, max_requests=100, retries=2):
    """Bound total API calls (including retries); abort on outage to conserve quota."""
    now = timezone.now()
    due = Video.objects.filter(
        Q(last_metadata_sync_at__isnull=True) | Q(last_metadata_sync_at__lte=now - REFRESH_AGE)
    ).order_by("last_metadata_sync_at", "id")
    # Work over a bounded identity snapshot so updates do not shift offset pagination.
    records = list(due.values_list("id", "external_id")[: batch_size * max_requests])
    calls = refreshed = 0
    for offset in range(0, len(records), batch_size):
        batch = records[offset : offset + batch_size]
        metadata = None
        for attempt in range(retries + 1):
            if calls >= max_requests:
                raise CommandError(
                    f"Request budget reached; refreshed={refreshed}. Remaining work is due."
                )
            calls += 1
            fetched_at = timezone.now()
            try:
                metadata = fetch_youtube_metadata_batch([external_id for _, external_id in batch])
                break
            except YouTubeAPIError as exc:
                error_code = (
                    f"provider_http_{exc.status_code}" if exc.status_code else "provider_failure"
                )
                Video.objects.filter(pk__in=[pk for pk, _ in batch]).update(
                    last_sync_error=error_code,
                    sync_failure_count=F("sync_failure_count") + 1,
                )
                # Quota/auth errors fail promptly; only transient server/network failures retry.
                if exc.status_code in (400, 401, 403, 429) or attempt == retries:
                    purge_expired_source_metadata()
                    raise CommandError(
                        f"Source refresh failed ({error_code}); requests={calls}."
                    ) from None
                sleep(2**attempt)
        for video_id, external_id in batch:
            if persist_refresh(video_id, metadata[external_id], fetched_at):
                refreshed += 1
    return {"refreshed": refreshed, "requests": calls, "last_success": timezone.now().isoformat()}


def expiry_due(batch_size=500):
    # Sweeps all expired records in bounded SQL batches; no external calls.
    total = 0
    from .services import expired_query

    while True:
        ids = list(
            Video.objects.filter(expired_query())
            .exclude(**SOURCE_DEFAULTS, availability=Video.Availability.UNKNOWN)
            .values_list("id", flat=True)[:batch_size]
        )
        if not ids:
            return total
        total += purge_expired_source_metadata(Video.objects.filter(pk__in=ids))
