from unittest.mock import patch
from urllib.parse import urlencode

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.catalog.models import Video, VideoIngredient
from apps.taxonomy.models import Cuisine, Ingredient, MealType
from tests.test_public_catalog import make_video as make_video

pytestmark = pytest.mark.django_db


def get(client, params=(), route="videos/"):
    response = client.get(f"/api/v1/{route}?{urlencode(params, doseq=True)}")
    assert response.status_code == 200, response.content
    return response.json()


def identities(data):
    return {row["id"] for row in data["results"]}


@pytest.fixture
def catalog(make_video):
    potato = Ingredient.objects.create(name="Potato")
    paneer = Ingredient.objects.create(name="Paneer")
    salt = Ingredient.objects.create(name="Salt")
    alias = Ingredient.objects.create(name="Aloo", canonical=potato)
    indian = Cuisine.objects.create(name="Indian")
    italian = Cuisine.objects.create(name="Italian")
    snack = MealType.objects.create(name="Snack")
    dinner = MealType.objects.create(name="Dinner")
    rows = [
        make_video(diet=diet, difficulty=difficulty, language=language, cook_time_minutes=minutes)
        for diet, difficulty, language, minutes in [
            ("VEGAN", 1, "en", 10),
            ("VEG", 2, "hi", 20),
            ("NON_VEG", 3, "bn", 30),
            ("UNKNOWN", None, "", None),
            ("VEG", 4, "en", 60),
            ("VEGAN", 5, "en", 61),
        ]
    ]
    rows[0].ingredients.set([potato, salt])
    rows[1].ingredients.set([potato, paneer, salt])
    rows[2].ingredients.set([paneer])
    rows[3].ingredients.set([salt])
    rows[4].ingredients.set([potato])
    rows[5].ingredients.set([paneer, salt])
    for row in rows[:3]:
        row.cuisines.set([indian, italian])
        row.meal_types.set([snack, dinner])
    VideoIngredient.objects.filter(video=rows[1], ingredient=potato).update(is_primary=True)
    return {
        "rows": rows,
        "potato": potato,
        "paneer": paneer,
        "salt": salt,
        "alias": alias,
        "indian": indian,
        "italian": italian,
        "snack": snack,
        "dinner": dinner,
    }


@pytest.mark.parametrize(
    "name,summary,query",
    [
        ("Crispy POTATO", "Quick snack", "snack crispy"),
        ("आलू कुरकुरा", "झटपट नाश्ता", "नाश्ता आलू"),
        ("আলু মুচমুচে", "দ্রুত নাস্তা", "নাস্তা আলু"),
    ],
)
def test_all_word_curated_search(client, make_video, name, summary, query):
    video = make_video()
    Video.objects.filter(pk=video.pk).update(recipe_name=name, recipe_summary=summary)
    other = make_video()
    Video.objects.filter(pk=other.pk).update(source_title=query, source_description=query)
    assert identities(get(client, {"q": query})) == {str(video.pk)}
    assert get(client, {"q": query + " impossible"})["count"] == 0
    assert get(client, {"q": "  "})["count"] == 2


@pytest.mark.parametrize(
    "params,indexes",
    [
        ({"diet": "VEG"}, [0, 1, 4, 5]),
        ({"diet": "VEGAN"}, [0, 5]),
        ({"diet": ["NON_VEG", "UNKNOWN"]}, [2, 3]),
        ({"max_time": "20"}, [0, 1]),
        ({"difficulty": "easy"}, [0, 1]),
        ({"difficulty": ["medium", "hard"]}, [2, 4, 5]),
        ({"language": ["hi", "bn"]}, [1, 2]),
        ({"diet": "VEG", "difficulty": "hard", "max_time": 60, "language": "en"}, [4]),
    ],
)
def test_composed_filters(client, catalog, params, indexes):
    assert identities(get(client, params)) == {str(catalog["rows"][index].pk) for index in indexes}


def test_canonical_alias_ingredient_and_and_relation_or(client, catalog):
    params = {
        "ingredient": [catalog["alias"].slug, catalog["potato"].slug, catalog["paneer"].slug],
        "cuisine": [catalog["indian"].slug, catalog["italian"].slug],
        "meal_type": [catalog["snack"].slug, catalog["dinner"].slug],
    }
    data = get(client, params)
    assert [row["id"] for row in data["results"]] == [str(catalog["rows"][1].pk)]
    assert data["query"]["ingredient"] == sorted([catalog["potato"].slug, catalog["paneer"].slug])


def counts(data, key):
    return {choice["value"]: choice["count"] for choice in data[key]}


def test_facets_exclude_self_and_ingredient_candidates_add_and(client, catalog):
    data = get(client, {"diet": "VEG", "ingredient": catalog["potato"].slug}, "filters/")
    assert data["count"] == 3
    assert counts(data, "diet") == {"VEG": 3, "VEGAN": 1, "NON_VEG": 0, "UNKNOWN": 0}
    assert counts(data, "ingredient")["potato"] == 3
    assert counts(data, "ingredient")["paneer"] == 1
    assert counts(data, "ingredient")["salt"] == 2
    assert counts(data, "difficulty") == {"easy": 2, "medium": 0, "hard": 1}
    both = get(client, {"ingredient": ["potato", "paneer"]}, "filters/")
    assert counts(both, "ingredient")["potato"] == counts(both, "ingredient")["paneer"] == 1
    data = get(client, {"diet": "NON_VEG", "difficulty": "easy", "max_time": 20}, "filters/")
    assert counts(data, "diet")["VEG"] == 2
    assert counts(data, "difficulty")["medium"] == 0
    data = get(client, {"max_time": 10}, "filters/")
    assert counts(data, "max_time") == {10: 1, 20: 2, 30: 3, 60: 4}


def test_alias_options_are_bounded_query_bound_and_retain_selection(client, catalog):
    row = catalog["rows"][0]
    for index in range(51):
        row.ingredients.add(Ingredient.objects.create(name=f"Option {index:03}"))
    data = get(client, {"ingredient_q": "aloo", "ingredient": "paneer"}, "filters/")
    assert [choice["value"] for choice in data["ingredient"]] == ["potato"]
    assert [choice["value"] for choice in data["selected_ingredients"]] == ["paneer"]
    params = {"ingredient_q": "Option"}
    found = []
    for size in (24, 24, 3):
        data = get(client, params, "filters/")
        assert len(data["ingredient"]) == size
        found.extend(choice["value"] for choice in data["ingredient"])
        params["ingredient_cursor"] = data["ingredient_next_cursor"]
    assert params["ingredient_cursor"] is None
    assert len(set(found)) == 51
    first = get(client, {"ingredient_q": "Option"}, "filters/")
    bad = client.get(
        "/api/v1/filters/",
        {"ingredient_q": "Other", "ingredient_cursor": first["ingredient_next_cursor"]},
    )
    assert bad.status_code == 400 and bad["Cache-Control"] == "no-store"
    assert get(client)["count"] == 6


def test_recipe_keysets_ties_query_binding_hide_and_terminal(client, make_video):
    videos = [make_video(diet="VEG") for _ in range(55)]
    Video.objects.all().update(created_at=timezone.now())
    ordered = sorted(videos, key=lambda row: row.pk, reverse=True)
    params = {"diet": ["VEG", "VEG"]}
    first = get(client, params)
    cursor = first["next_cursor"]
    assert first["count"] == 55 and len(first["results"]) == 24
    assert client.get("/api/v1/videos/", {"diet": "VEGAN", "cursor": cursor}).status_code == 400
    # A hidden cursor anchor remains a valid position; next-page visibility is fresh.
    Video.objects.filter(pk__in=[ordered[23].pk, ordered[24].pk]).update(status="HIDDEN")
    collected = [row["id"] for row in first["results"]]
    params["cursor"] = cursor
    while params["cursor"]:
        data = get(client, params)
        assert data["count"] == 53
        collected.extend(row["id"] for row in data["results"])
        params["cursor"] = data["next_cursor"]
    assert collected == [str(row.pk) for row in ordered if row != ordered[24]]
    assert len(collected) == len(set(collected))


@pytest.mark.parametrize(
    "query",
    [
        "q=a&q=b",
        "sort=title",
        "max_time=-1",
        "max_time=0",
        "max_time=1.5",
        "max_time=2147483648",
        "language=xx",
        "difficulty=1",
        "diet=vegetarian",
        "ingredient=missing",
        "cuisine=missing",
        "meal_type=missing",
        "cursor=broken",
        "limit=100",
        "offset=24",
        "ingredient_q=aloo",
        "ingredient_cursor=broken",
    ],
)
def test_invalid_or_unsupported_feed_query_no_store(client, query):
    response = client.get("/api/v1/videos/?" + query)
    assert response.status_code == 400
    assert response["Cache-Control"] == "no-store" and not response.cookies


def test_contextual_neighbors_same_matching_and_published_outside_context(client, catalog):
    rows = catalog["rows"]
    matching = sorted(
        [rows[index] for index in (0, 1, 4, 5)], key=lambda row: row.created_at, reverse=True
    )
    for index, video in enumerate(matching):
        data = get(client, {"diet": "VEG"}, f"videos/{video.slug}/neighbors/")
        assert data["in_context"]
        assert data["previous"] == (
            {"id": str(matching[index - 1].pk), "slug": matching[index - 1].slug} if index else None
        )
        assert data["next"] == (
            {"id": str(matching[index + 1].pk), "slug": matching[index + 1].slug}
            if index + 1 < len(matching)
            else None
        )
    outside = get(client, {"diet": "VEG"}, f"videos/{rows[2].slug}/neighbors/")
    assert outside == {"previous": None, "next": None, "in_context": False}
    assert client.get(f"/shorts/{rows[2].slug}?diet=VEG").status_code == 200
    assert client.get(f"/api/v1/videos/{rows[2].slug}/neighbors/?cursor=x").status_code == 400


def test_public_facets_visibility_cookies_etags_and_clean_watch_metadata(
    client, catalog, make_video
):
    hidden = make_video("HIDDEN")
    private_tag = Ingredient.objects.create(name="Hidden-only ingredient")
    hidden.ingredients.add(private_tag)
    draft = make_video("DRAFT")
    draft.cuisines.add(Cuisine.objects.create(name="Draft-only cuisine"))
    client.force_login(
        get_user_model().objects.create_superuser("phase4@example.invalid", "password")
    )
    with patch(
        "django.contrib.sessions.backends.db.SessionStore.load",
        side_effect=AssertionError("session read"),
    ):
        response = client.get("/api/v1/filters/?diet=VEG")
        assert response.status_code == 200 and not response.cookies
        assert (
            "Hidden-only" not in response.content.decode()
            and "Draft-only" not in response.content.decode()
        )
        assert (
            client.get("/api/v1/filters/?diet=VEG", HTTP_IF_NONE_MATCH=response["ETag"]).status_code
            == 304
        )
        Video.objects.filter(pk=catalog["rows"][0].pk).update(status="HIDDEN")
        assert (
            client.get("/api/v1/filters/?diet=VEG", HTTP_IF_NONE_MATCH=response["ETag"]).status_code
            == 200
        )
    video = catalog["rows"][1]
    html = client.get(f"/shorts/{video.slug}?ingredient=aloo&q=potato").content.decode()
    assert f'<link rel="canonical" href="http://testserver/shorts/{video.slug}">' in html
    assert 'href="/?q=potato&amp;ingredient=potato"' in html


def test_filtered_feed_source_reads_are_batched(client, catalog, django_assert_max_num_queries):
    with django_assert_max_num_queries(10):
        response = client.get("/api/v1/videos/?ingredient=potato&diet=VEG")
    assert response.status_code == 200


def test_cursor_representations_have_stable_etags_across_time(client, make_video):
    videos = [make_video() for _ in range(25)]
    videos[0].ingredients.set(
        [Ingredient.objects.create(name=f"Cursor option {i:03}") for i in range(25)]
    )
    for url, cursor_key in (
        ("/api/v1/videos/", "next_cursor"),
        ("/api/v1/filters/", "ingredient_next_cursor"),
    ):
        original = client.get(url)
        assert original.json()[cursor_key]
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 60):
            unchanged = client.get(url, HTTP_IF_NONE_MATCH=original["ETag"])
        assert unchanged.status_code == 304 and unchanged["ETag"] == original["ETag"]
