"""Non-personalized, publication-checked catalog reads."""

import hashlib

from django.db.models import Q
from django.http import HttpResponseNotModified, QueryDict
from django.utils.http import parse_etags
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from .discovery import PAGE_SIZE, facets, matching, recipe_page, scalar, validate
from .models import EditorialPolicy, Video
from .services import read_source_metadata, read_source_metadata_batch

FEED_LIMIT = PAGE_SIZE


def published():
    return Video.objects.filter(status=Video.Status.PUBLISHED).prefetch_related(
        "cuisines", "meal_types", "ingredients"
    )


def public_video(video, source=None):
    source = source if source is not None else read_source_metadata(video)
    return {
        "id": str(video.pk),
        "slug": video.slug,
        "recipe_name": video.recipe_name,
        "recipe_summary": video.recipe_summary,
        "diet": video.diet,
        "diet_label": video.get_diet_display(),
        "cook_time_minutes": video.cook_time_minutes,
        "difficulty": video.difficulty,
        "language": video.language or None,
        "cuisines": [tag.name for tag in video.cuisines.all()],
        "meal_types": [tag.name for tag in video.meal_types.all()],
        "ingredients": [tag.name for tag in video.ingredients.all()],
        "external_id": video.external_id,
        "canonical_url": video.canonical_url,
        "creator_name": source["creator_name"] or None,
        "creator_url": source["creator_url"] or None,
        "thumbnail_url": source["thumbnail_url"] or None,
        "availability": source["availability"],
        "embeddable": source["embeddable"],
    }


def conditional(request, response):
    """Hash the actual representation after visibility and expiry have been resolved."""
    if response.status_code != 200:
        response["Cache-Control"] = "no-store"
        return response
    if hasattr(response, "render"):
        response.accepted_renderer = JSONRenderer()
        response.accepted_media_type = "application/json"
        response.renderer_context = {}
        response.render()
    etag = '"' + hashlib.sha256(response.content).hexdigest() + '"'
    matches = parse_etags(request.headers.get("If-None-Match", ""))
    if "*" in matches or any(value.removeprefix("W/") == etag for value in matches):
        response = HttpResponseNotModified()
    response["ETag"] = etag
    response["Cache-Control"] = "public, max-age=0, must-revalidate"
    response["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


def reject_query(request):
    if request.GET:
        return Response({"detail": "Query parameters are not supported in this phase."}, status=400)


@api_view(["GET", "HEAD"])
@authentication_classes([])
@permission_classes([AllowAny])
def feed(request):
    try:
        query = validate(request.GET, extra=("cursor",))
        page, count, next_cursor = recipe_page(query, scalar(request.GET, "cursor", limit=2048))
    except ValidationError as error:
        return conditional(request, Response(error.detail, status=400))
    sources = read_source_metadata_batch([video.pk for video in page])
    policy = EditorialPolicy.objects.filter(pk=1).values_list("explanation", flat=True).first()
    return conditional(
        request,
        Response(
            {
                "results": [public_video(video, sources[video.pk]) for video in page],
                "count": count,
                "next_cursor": next_cursor,
                "query": query,
                "limit": FEED_LIMIT,
                "diet_policy": policy or "",
            }
        ),
    )


@api_view(["GET", "HEAD"])
@authentication_classes([])
@permission_classes([AllowAny])
def detail(request, slug):
    video = published().filter(slug=slug).first()
    if video is None:
        return conditional(request, Response({"detail": "Recipe not found."}, status=404))
    error = reject_query(request)
    return conditional(request, error if error is not None else Response(public_video(video)))


def neighbor_data(video, query=None):
    videos = matching(query or validate(QueryDict())).only("id", "slug", "created_at")
    if not videos.filter(pk=video.pk).exists():
        return {"previous": None, "next": None, "in_context": False}
    newer = (
        videos.filter(
            Q(created_at__gt=video.created_at) | Q(created_at=video.created_at, id__gt=video.id)
        )
        .order_by("created_at", "id")
        .first()
    )
    older = videos.filter(
        Q(created_at__lt=video.created_at) | Q(created_at=video.created_at, id__lt=video.id)
    ).first()

    def identity(item):
        return {"id": str(item.pk), "slug": item.slug} if item else None

    return {"previous": identity(newer), "next": identity(older), "in_context": True}


@api_view(["GET", "HEAD"])
@authentication_classes([])
@permission_classes([AllowAny])
def neighbors(request, slug):
    video = published().filter(slug=slug).first()
    if video is None:
        return conditional(request, Response({"detail": "Recipe not found."}, status=404))
    try:
        data = neighbor_data(video, validate(request.GET))
    except ValidationError as error:
        return conditional(request, Response(error.detail, status=400))
    return conditional(request, Response(data))


@api_view(["GET", "HEAD"])
@authentication_classes([])
@permission_classes([AllowAny])
def filters(request):
    try:
        query = validate(request.GET, extra=("ingredient_q", "ingredient_cursor"))
        data = facets(query, request.GET)
    except ValidationError as error:
        return conditional(request, Response(error.detail, status=400))
    return conditional(request, Response(data))
