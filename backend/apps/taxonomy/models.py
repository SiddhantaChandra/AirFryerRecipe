import unicodedata

from django.core.exceptions import ValidationError
from django.db import models
from django.utils.text import slugify


def name_key(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


class Vocabulary(models.Model):
    """Aliases are named rows pointing directly at a canonical row in the same vocabulary."""

    name = models.CharField(max_length=120)
    key = models.CharField(max_length=240, unique=True, editable=False)
    slug = models.SlugField(max_length=160, unique=True, allow_unicode=True, editable=False)
    canonical = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="aliases"
    )

    class Meta:
        abstract = True
        ordering = ("name",)

    def __str__(self):
        return self.name if not self.canonical_id else f"{self.name} → {self.canonical.name}"

    def clean(self):
        super().clean()
        if not name_key(self.name):
            raise ValidationError({"name": "Enter a vocabulary name."})
        if self.canonical_id:
            if self.canonical_id == self.pk or self.canonical.canonical_id:
                raise ValidationError({"canonical": "Choose a canonical entry, not an alias."})
            if self.pk and self.aliases.exists():
                raise ValidationError({"canonical": "An entry with aliases must remain canonical."})
            if self.pk and self.videos.exists():
                raise ValidationError(
                    {"canonical": "An entry used by recipes must remain canonical."}
                )

    def save(self, *args, **kwargs):
        self.name = " ".join(self.name.split())
        self.key = name_key(self.name)
        if not self.slug:
            self.slug = slugify(self.key, allow_unicode=True)
            if not self.slug:
                raise ValidationError({"name": "Name must contain letters or numbers."})
        if self.pk:
            original = type(self).objects.get(pk=self.pk)
            if self.slug != original.slug:
                raise ValidationError("Vocabulary slugs are immutable.")
        self.full_clean()
        return super().save(*args, **kwargs)

    @classmethod
    def resolve(cls, name):
        term = cls.objects.select_related("canonical").get(key=name_key(name))
        return term.canonical or term


class Cuisine(Vocabulary):
    pass


class Ingredient(Vocabulary):
    pass


class MealType(Vocabulary):
    pass
