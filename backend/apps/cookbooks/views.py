"""Private, bounded activity APIs. All writes lock User -> Cookbook -> Video.

The owner lock also serializes account deletion. Video row locks coordinate with
editorial UPDATEs, so publication is checked at the actual write boundary.
"""

from functools import wraps
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Prefetch
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.views import error, read_json
from apps.catalog.models import Video
from apps.catalog.public import public_video
from apps.catalog.services import read_source_metadata_batch

from .models import Cookbook, CookbookItem, VideoLike


def endpoint(*methods):
    def decorate(view):
        @wraps(view)
        def wrapped(request, **kwargs):
            if request.method not in methods:
                response = error("Method not allowed.", 405)
                response["Allow"] = ", ".join(methods)
                return response
            if not request.user.is_authenticated or not request.user.is_active:
                return error("Please log in again.", 401)
            try:
                if request.method == "GET":
                    return view(request, **kwargs)
                with transaction.atomic():
                    user = (
                        User.objects.select_for_update()
                        .filter(pk=request.user.pk, is_active=True)
                        .first()
                    )
                    if user is None:
                        return error("Please log in again.", 401)
                    request.user = user
                    return view(request, **kwargs)
            except (ValueError, TypeError) as exc:
                return error(str(exc) or "Invalid request.")
            except Http404:
                return error("Not found.", 404)

        return wrapped

    return decorate


def payload(request, allowed, required=(), *, max_bytes=16384):
    data = read_json(request, max_bytes=max_bytes)
    if set(data) - set(allowed) or set(required) - set(data):
        raise ValueError("Provide only the supported fields: " + ", ".join(allowed))
    return data


def identity(value):
    if not isinstance(value, str) or len(value) != 36:
        raise ValueError("Provide a valid UUID.")
    return UUID(value)


def text_fields(data):
    for key, maximum in (("name", 150), ("description", 2000)):
        if key in data:
            if not isinstance(data[key], str) or len(data[key]) > maximum:
                raise ValueError(f"{key} must be text of at most {maximum} characters.")
            data[key] = data[key].strip()
    if "name" in data and not data["name"]:
        raise ValueError("Enter a Cookbook name.")
    return data


def limits():
    return {"cookbooks": settings.COOKBOOK_OWNER_LIMIT, "items": settings.COOKBOOK_ITEM_LIMIT}


def owned(request, pk):
    rows = Cookbook.objects.filter(user=request.user)
    if request.method != "GET":
        rows = rows.select_for_update()
    return get_object_or_404(rows, pk=pk)


def collection_data(rows, *, detail=False):
    # One source batch and fixed prefetches, never a source lookup per card/item.
    rows = list(
        rows.prefetch_related(
            Prefetch(
                "items",
                queryset=CookbookItem.objects.select_related("video").prefetch_related(
                    "video__cuisines", "video__ingredients", "video__meal_types"
                ),
            )
        )
    )
    visible = {
        item.video_id
        for book in rows
        for item in book.items.all()
        if item.video.status == Video.Status.PUBLISHED
    }
    sources = read_source_metadata_batch(visible)
    counts = dict(
        VideoLike.objects.filter(video_id__in=visible)
        .values("video_id")
        .annotate(total=Count("pk"))
        .values_list("video_id", "total")
    )
    output = []
    for book in rows:
        entries, cover = [], None
        for item in book.items.all():
            entry = {
                "video_id": str(item.video_id),
                "position": item.position,
                "added_at": item.added_at.isoformat(),
                "state": "archive_unavailable",
            }
            if item.video.status == Video.Status.PUBLISHED:
                source = sources[item.video_id]
                item.video.like_count = counts.get(item.video_id, 0)
                entry["video"] = public_video(item.video, source)
                available = (
                    source["availability"] == Video.Availability.OK
                    and source["embeddable"] is not False
                )
                entry["state"] = "available" if available else "source_unavailable"
                if cover is None and available and source["thumbnail_url"]:
                    cover = {"thumbnail_url": source["thumbnail_url"]}
            entries.append(entry)
        data = {
            "id": str(book.pk),
            "name": book.name,
            "description": book.description,
            "created_at": book.created_at.isoformat(),
            "updated_at": book.updated_at.isoformat(),
            "count": len(entries),
            "cover": cover,
        }
        if detail:
            data["items"] = entries
            data["limits"] = limits()
        output.append(data)
    return output


def one(book):
    rows = collection_data(Cookbook.objects.filter(pk=book.pk), detail=True)
    if not rows:
        raise Http404
    return rows[0]


def touch(book):
    book.updated_at = timezone.now()
    book.save(update_fields=["updated_at"])


def normalize(book, items=None):
    items = list(book.items.all()) if items is None else items
    for position, item in enumerate(items):
        item.position = position
    CookbookItem.objects.bulk_update(items, ["position"])
    touch(book)


@endpoint("GET")
def video_state(request):
    if set(request.GET) != {"ids"} or len(request.GET.getlist("ids")) != 1:
        raise ValueError("Provide one ids batch.")
    raw = request.GET["ids"]
    if len(raw) > 3699:
        raise ValueError("Select at most 100 recipe IDs.")
    values = raw.split(",")
    if not 1 <= len(values) <= 100:
        raise ValueError("Select 1 to 100 recipe IDs.")
    ids = {identity(value) for value in values}
    visible = list(
        Video.objects.filter(pk__in=ids, status=Video.Status.PUBLISHED).values_list("pk", flat=True)
    )
    liked = set(
        VideoLike.objects.filter(user=request.user, video_id__in=visible).values_list(
            "video_id", flat=True
        )
    )
    membership = {pk: [] for pk in visible}
    for video_id, cookbook_id in (
        CookbookItem.objects.filter(cookbook__user=request.user, video_id__in=visible)
        .order_by("cookbook_id")
        .values_list("video_id", "cookbook_id")
    ):
        membership[video_id].append(str(cookbook_id))
    return JsonResponse(
        {
            "results": {
                str(pk): {"liked": pk in liked, "cookbook_ids": membership[pk]} for pk in visible
            }
        }
    )


@endpoint("POST", "DELETE")
def like(request, video_id):
    payload(request, ())
    if request.method == "POST":
        video = get_object_or_404(
            Video.objects.select_for_update(), pk=video_id, status=Video.Status.PUBLISHED
        )
        VideoLike.objects.get_or_create(user=request.user, video=video)
        return JsonResponse(
            {"liked": True, "like_count": VideoLike.objects.filter(video=video).count()}
        )
    # Desired-state deletion is successful even if already absent, hidden or missing.
    VideoLike.objects.filter(user=request.user, video_id=video_id).delete()
    return HttpResponse(status=204)


@endpoint("GET", "POST")
def cookbooks(request):
    if request.method == "GET":
        if request.GET:
            raise ValueError("Query parameters are not supported.")
        return JsonResponse(
            {
                "results": collection_data(Cookbook.objects.filter(user=request.user)),
                "limits": limits(),
            }
        )
    data = text_fields(payload(request, ("name", "description"), ("name",)))
    if Cookbook.objects.filter(user=request.user).count() >= settings.COOKBOOK_OWNER_LIMIT:
        return error(f"You can have at most {settings.COOKBOOK_OWNER_LIMIT} Cookbooks.", 409)
    book = Cookbook.objects.create(user=request.user, **data)
    return JsonResponse(one(book), status=201)


@endpoint("GET", "PATCH", "DELETE")
def cookbook(request, cookbook_id):
    book = owned(request, cookbook_id)
    if request.method == "DELETE":
        payload(request, ())
        book.delete()
        return HttpResponse(status=204)
    if request.method == "PATCH":
        data = text_fields(payload(request, ("name", "description")))
        for key, value in data.items():
            setattr(book, key, value)
        book.save()
    return JsonResponse(one(book))


@endpoint("POST")
def add_item(request, cookbook_id):
    book = owned(request, cookbook_id)
    data = payload(request, ("video_id",), ("video_id",))
    video = get_object_or_404(
        Video.objects.select_for_update(),
        pk=identity(data["video_id"]),
        status=Video.Status.PUBLISHED,
    )
    if not book.items.filter(video=video).exists():
        if book.items.count() >= settings.COOKBOOK_ITEM_LIMIT:
            return error(
                f"This Cookbook holds at most {settings.COOKBOOK_ITEM_LIMIT} recipes.", 409
            )
        CookbookItem.objects.create(cookbook=book, video=video, position=book.items.count())
        touch(book)
    return JsonResponse({"saved": True})


@endpoint("DELETE")
def remove_item(request, cookbook_id, video_id):
    book = owned(request, cookbook_id)
    payload(request, ())
    if book.items.filter(video_id=video_id).delete()[0]:
        normalize(book)
    return HttpResponse(status=204)


@endpoint("PATCH")
def reorder(request, cookbook_id):
    book = owned(request, cookbook_id)
    maximum = max(settings.COOKBOOK_ITEM_LIMIT, book.items.count())
    # A raised cap (or retained membership after a lowered cap) must still fit
    # a complete UUID permutation, while keeping the accepted body bounded.
    data = payload(
        request, ("video_ids",), ("video_ids",), max_bytes=max(16384, maximum * 40 + 1024)
    )
    values = data["video_ids"]
    if not isinstance(values, list) or len(values) > maximum:
        raise ValueError("Provide the complete ordered video_ids list.")
    ids = [identity(value) for value in values]
    current = {item.video_id: item for item in book.items.all()}
    if len(set(ids)) != len(ids) or set(ids) != set(current):
        return error(
            "The saved recipes changed. Reload and submit each current video ID exactly once.", 409
        )
    normalize(book, [current[pk] for pk in ids])
    return JsonResponse({"video_ids": [str(pk) for pk in ids]})
