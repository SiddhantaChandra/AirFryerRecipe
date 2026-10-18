"""Validated public discovery queries, shared by pages, facets and neighbors."""

import hashlib
import json
import re
from uuid import UUID

from django.conf import settings
from django.core import signing
from django.db.models import Count, Exists, OuterRef, Q
from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_aware
from rest_framework.exceptions import ValidationError

from apps.taxonomy.models import Cuisine, Ingredient, MealType

from .models import Video

PAGE_SIZE = 24
MULTI = ("diet", "ingredient", "cuisine", "meal_type", "difficulty", "language")
TAXONOMY = {"ingredient": Ingredient, "cuisine": Cuisine, "meal_type": MealType}
RELATIONS = {"ingredient": "ingredients", "cuisine": "cuisines", "meal_type": "meal_types"}
DIFFICULTY = {"easy": (1, 2), "medium": (3,), "hard": (4, 5)}


def scalar(params, key, default="", limit=240):
    values = params.getlist(key)
    if len(values) > 1 or (values and len(values[0]) > limit):
        raise ValidationError({key: "Provide one bounded value."})
    return values[0] if values else default


def validate(params, *, extra=()):
    unknown = set(params) - set(MULTI) - {"q", "max_time", "sort"} - set(extra)
    if unknown:
        raise ValidationError({"query": f"Unsupported parameters: {', '.join(sorted(unknown))}."})
    query = {"q": " ".join(scalar(params, "q").split()), "sort": scalar(params, "sort", "newest")}
    if query["sort"] != "newest":
        raise ValidationError({"sort": "Only newest ordering is supported."})
    for key in MULTI:
        values = params.getlist(key)
        if len(values) > 40 or any(not value or len(value) > 160 for value in values):
            raise ValidationError({key: "Select at most 40 valid choices."})
        values = sorted(set(values))
        if key in TAXONOMY:
            rows = TAXONOMY[key].objects.select_related("canonical").filter(slug__in=values)
            resolved = {row.slug: (row.canonical or row).slug for row in rows}
            if set(values) - resolved.keys():
                raise ValidationError({key: "Choose an existing taxonomy slug."})
            values = sorted({resolved[value] for value in values})
        else:
            allowed = {
                "diet": set(Video.Diet.values),
                "difficulty": set(DIFFICULTY),
                "language": {code.split("-")[0] for code, _ in settings.LANGUAGES},
            }[key]
            if set(values) - allowed:
                raise ValidationError({key: "Choose a supported value."})
        query[key] = values
    maximum = scalar(params, "max_time", limit=10)
    if maximum and (not re.fullmatch(r"[0-9]+", maximum) or not 0 < int(maximum) <= 2147483647):
        raise ValidationError({"max_time": "Enter positive whole cooking minutes."})
    query["max_time"] = int(maximum) if maximum else None
    return query


def matching(query, *, exclude=None):
    videos = Video.objects.filter(status=Video.Status.PUBLISHED)
    for word in query["q"].split():
        videos = videos.filter(Q(recipe_name__icontains=word) | Q(recipe_summary__icontains=word))
    for key in MULTI:
        values = query[key]
        if key == exclude or not values:
            continue
        if key in RELATIONS:
            relation = RELATIONS[key]
            # EXISTS keeps each recipe unique without a large DISTINCT over source fields.
            groups = [[value] for value in values] if key == "ingredient" else [values]
            for group in groups:
                related = Video.objects.filter(
                    pk=OuterRef("pk"), **{f"{relation}__slug__in": group}
                )
                videos = videos.filter(Exists(related))
        elif key == "diet":
            expanded = set(values) | ({"VEGAN"} if "VEG" in values else set())
            videos = videos.filter(diet__in=expanded)
        elif key == "difficulty":
            videos = videos.filter(
                difficulty__in=[number for value in values for number in DIFFICULTY[value]]
            )
        else:
            videos = videos.filter(language__in=values)
    if exclude != "max_time" and query["max_time"] is not None:
        videos = videos.filter(cook_time_minutes__lte=query["max_time"])
    return videos.order_by("-created_at", "-id")


def fingerprint(query):
    return hashlib.sha256(
        json.dumps(query, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def encode_cursor(query, position, kind):
    # Deterministic signatures keep unchanged paginated representations' ETags
    # stable. These read-only positions need query binding, not timed expiry.
    return signing.Signer(salt=f"discovery.{kind}").sign_object(
        {"query": fingerprint(query), "position": position}
    )


def decode_cursor(value, query, kind):
    try:
        if len(value) > 2048:
            raise ValueError
        data = signing.Signer(salt=f"discovery.{kind}").unsign_object(value)
        if data["query"] != fingerprint(query):
            raise ValueError
        return data["position"]
    except (signing.BadSignature, KeyError, ValueError, TypeError):
        raise ValidationError({"cursor": "Invalid cursor or cursor from another query."}) from None


def recipe_page(query, cursor):
    videos = matching(query)
    count = videos.count()
    if cursor:
        try:
            timestamp, identity = decode_cursor(cursor, query, "recipes")
            timestamp, identity = parse_datetime(timestamp), UUID(identity)
            if timestamp is None or not is_aware(timestamp):
                raise ValueError
        except (ValueError, TypeError):
            raise ValidationError({"cursor": "Invalid recipe cursor."}) from None
        videos = videos.filter(
            Q(created_at__lt=timestamp) | Q(created_at=timestamp, id__lt=identity)
        )
    page = list(
        videos.annotate(like_count=Count("likes")).prefetch_related(
            "cuisines", "meal_types", "ingredients"
        )[: PAGE_SIZE + 1]
    )
    continuation = None
    if len(page) > PAGE_SIZE:
        page = page[:PAGE_SIZE]
        continuation = encode_cursor(
            query, [page[-1].created_at.isoformat(), str(page[-1].pk)], "recipes"
        )
    return page, count, continuation


def counted(queryset, field):
    return dict(
        queryset.order_by()
        .values(field)
        .annotate(total=Count("pk", distinct=True))
        .values_list(field, "total")
    )


def facets(query, params):
    result = {"query": query}
    diets = counted(matching(query, exclude="diet"), "diet")
    result["diet"] = [
        {
            "value": value,
            "label": label,
            "count": diets.get(value, 0) + (diets.get("VEGAN", 0) if value == "VEG" else 0),
        }
        for value, label in Video.Diet.choices
    ]
    difficulties = counted(matching(query, exclude="difficulty"), "difficulty")
    result["difficulty"] = [
        {
            "value": value,
            "label": value.title(),
            "count": sum(difficulties.get(n, 0) for n in numbers),
        }
        for value, numbers in DIFFICULTY.items()
    ]
    # Public choices are the vocabulary in published recipes, plus explicitly selected
    # canonical values retained for removal even after their recipes disappear.
    for key in ("cuisine", "meal_type"):
        counts = counted(matching(query, exclude=key), f"{RELATIONS[key]}__slug")
        rows = (
            TAXONOMY[key]
            .objects.filter(canonical__isnull=True)
            .filter(Q(videos__status="PUBLISHED") | Q(slug__in=query[key]))
            .distinct()
        )
        result[key] = [
            {"value": row.slug, "label": row.name, "count": counts.get(row.slug, 0)} for row in rows
        ]
    languages = counted(matching(query, exclude="language"), "language")
    public_languages = set(
        Video.objects.filter(status="PUBLISHED")
        .exclude(language="")
        .values_list("language", flat=True)
    ) | set(query["language"])
    labels = {code: str(label) for code, label in settings.LANGUAGES}
    result["language"] = [
        {"value": code, "label": labels.get(code, code), "count": languages.get(code, 0)}
        for code in sorted(public_languages)
    ]
    times = matching(query, exclude="max_time")
    time_counts = times.aggregate(
        **{f"t{n}": Count("pk", filter=Q(cook_time_minutes__lte=n)) for n in (10, 20, 30, 60)}
    )
    result["max_time"] = [
        {"value": n, "label": f"{n} minutes or less", "count": time_counts[f"t{n}"]}
        for n in (10, 20, 30, 60)
    ]
    # Ingredients keep every selected ingredient constraint, then add the candidate.
    counts = counted(matching(query), "ingredients__slug")
    current_count = matching(query).count()
    option_q = " ".join(scalar(params, "ingredient_q", limit=120).split())
    option_cursor = scalar(params, "ingredient_cursor", limit=2048)
    options = Ingredient.objects.filter(
        canonical__isnull=True, videos__status="PUBLISHED"
    ).distinct()
    if option_q:
        options = options.filter(Q(name__icontains=option_q) | Q(aliases__name__icontains=option_q))
    option_binding = {**query, "ingredient_q": option_q}
    if option_cursor:
        try:
            key, identity = decode_cursor(option_cursor, option_binding, "ingredients")
            if not isinstance(key, str) or not isinstance(identity, int):
                raise ValueError
        except (ValueError, TypeError):
            raise ValidationError({"ingredient_cursor": "Invalid ingredient cursor."}) from None
        options = options.filter(Q(key__gt=key) | Q(key=key, pk__gt=identity))
    page = list(options.order_by("key", "pk")[: PAGE_SIZE + 1])
    continuation = None
    if len(page) > PAGE_SIZE:
        page = page[:PAGE_SIZE]
        continuation = encode_cursor(option_binding, [page[-1].key, page[-1].pk], "ingredients")

    def choice(row):
        return {
            "value": row.slug,
            "label": row.name,
            "count": current_count if row.slug in query["ingredient"] else counts.get(row.slug, 0),
        }

    result["ingredient"] = [choice(row) for row in page]
    result["selected_ingredients"] = [
        choice(row) for row in Ingredient.objects.filter(slug__in=query["ingredient"])
    ]
    result["ingredient_next_cursor"] = continuation
    result["count"] = current_count
    return result
