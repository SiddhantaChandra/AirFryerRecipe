import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.db.models.deletion import ProtectedError
from django.utils.text import slugify


def validate_language(value):
    known_codes = {code.split("-")[0] for code, _ in settings.LANGUAGES}
    if value and value not in known_codes:
        raise ValidationError("Choose a known ISO language code, or leave it unknown.")


class EditorialPolicy(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    explanation = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "editorial policy"
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="one_diet_policy")]

    def __str__(self):
        return "Diet classification policy"


class VideoQuerySet(models.QuerySet):
    def delete(self):
        raise ProtectedError("Hide catalog records instead of deleting them.", list(self))


class Video(models.Model):
    class Diet(models.TextChoices):
        VEGAN = "VEGAN", "Vegan"
        VEG = "VEG", "Vegetarian"
        NON_VEG = "NON_VEG", "Non-vegetarian"
        UNKNOWN = "UNKNOWN", "Unknown"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PUBLISHED = "PUBLISHED", "Published"
        HIDDEN = "HIDDEN", "Hidden"

    class Availability(models.TextChoices):
        UNKNOWN = "UNKNOWN", "Source metadata unavailable / unknown"
        OK = "OK", "Available"
        EMBED_BLOCKED = "EMBED_BLOCKED", "Embedding blocked"
        UNAVAILABLE = "UNAVAILABLE", "Unavailable / private / removed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=200, unique=True, editable=False, allow_unicode=True)
    platform = models.CharField(max_length=16, default="YOUTUBE", editable=False)
    external_id = models.CharField(
        max_length=11, validators=[RegexValidator(r"\A[a-zA-Z0-9_-]{11}\Z")]
    )
    canonical_url = models.URLField(max_length=200, editable=False)
    source_title = models.TextField(blank=True)
    source_description = models.TextField(blank=True)
    creator_name = models.TextField(blank=True)
    creator_url = models.URLField(max_length=500, blank=True)
    thumbnail_url = models.URLField(max_length=1000, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    source_published_at = models.DateTimeField(null=True, blank=True)
    embeddable = models.BooleanField(null=True, blank=True)
    provider_status = models.CharField(max_length=40, blank=True)
    last_metadata_sync_at = models.DateTimeField(null=True, blank=True)
    last_availability_check_at = models.DateTimeField(null=True, blank=True)
    last_sync_error = models.CharField(max_length=100, blank=True)
    sync_failure_count = models.PositiveIntegerField(default=0)
    recipe_name = models.CharField(max_length=240)
    recipe_summary = models.TextField(blank=True)
    diet = models.CharField(max_length=12, choices=Diet, default=Diet.UNKNOWN)
    language = models.CharField(
        max_length=3,
        blank=True,
        validators=[RegexValidator(r"\A[a-z]{2,3}\Z"), validate_language],
    )
    cook_time_minutes = models.PositiveIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1)]
    )
    difficulty = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    cuisines = models.ManyToManyField("taxonomy.Cuisine", blank=True, related_name="videos")
    meal_types = models.ManyToManyField("taxonomy.MealType", blank=True, related_name="videos")
    ingredients = models.ManyToManyField(
        "taxonomy.Ingredient", through="VideoIngredient", blank=True, related_name="videos"
    )
    status = models.CharField(max_length=12, choices=Status, default=Status.DRAFT)
    availability = models.CharField(
        max_length=16, choices=Availability, default=Availability.UNKNOWN
    )
    diet_reviewed = models.BooleanField(default=False)
    air_fryer_confirmed = models.BooleanField(default=False)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_videos",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="added_videos",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = VideoQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "-id")
        permissions = [
            ("publish_video", "Can review and publish videos"),
            ("hide_video", "Can hide videos"),
            ("refresh_video", "Can refresh source metadata"),
        ]
        constraints = [
            models.UniqueConstraint(fields=("platform", "external_id"), name="unique_video_source"),
            models.CheckConstraint(condition=models.Q(platform="YOUTUBE"), name="youtube_only"),
            models.CheckConstraint(
                condition=models.Q(difficulty__isnull=True) | models.Q(difficulty__range=(1, 5)),
                name="difficulty_1_to_5",
            ),
            models.CheckConstraint(
                condition=models.Q(cook_time_minutes__isnull=True)
                | models.Q(cook_time_minutes__gt=0),
                name="positive_cook_time",
            ),
            models.CheckConstraint(
                condition=~models.Q(status="PUBLISHED")
                | (
                    models.Q(diet_reviewed=True, air_fryer_confirmed=True)
                    & models.Q(reviewed_at__isnull=False)
                ),
                name="publication_requires_review",
            ),
        ]
        indexes = [models.Index(fields=("status", "created_at", "id"), name="video_status_created")]

    def __str__(self):
        return self.recipe_name

    def clean(self):
        super().clean()
        if self.status == self.Status.PUBLISHED and (
            not self.diet_reviewed or not self.air_fryer_confirmed or not self.reviewed_at
        ):
            raise ValidationError("Diet review and air-fryer confirmation are required to publish.")

    def save(self, *args, **kwargs):
        if self._state.adding:
            # Inline formsets may clear a generated parent UUID before insertion.
            self.id = self.id or uuid.uuid4()
            prefix = slugify(self.recipe_name, allow_unicode=True)[:150] or "recipe"
            self.slug = self.slug or f"{prefix}-{self.id.hex}"
            self.canonical_url = f"https://www.youtube.com/watch?v={self.external_id}"
        else:
            original = (
                type(self)
                .objects.only("slug", "platform", "external_id", "canonical_url")
                .get(pk=self.pk)
            )
            if any(
                getattr(original, field) != getattr(self, field)
                for field in ("slug", "platform", "external_id", "canonical_url")
            ):
                raise ValidationError("Video slug and source identity are immutable.")
        self.clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ProtectedError("Hide catalog records instead of deleting them.", [self])


class VideoIngredient(models.Model):
    video = models.ForeignKey(Video, on_delete=models.PROTECT, related_name="ingredient_links")
    ingredient = models.ForeignKey("taxonomy.Ingredient", on_delete=models.PROTECT)
    is_primary = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("video", "ingredient"), name="unique_video_ingredient")
        ]

    def clean(self):
        if self.ingredient_id and self.ingredient.canonical_id:
            raise ValidationError({"ingredient": "Choose the canonical ingredient, not an alias."})
