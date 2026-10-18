import uuid

from django.conf import settings
from django.db import models


class VideoLike(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    video = models.ForeignKey("catalog.Video", on_delete=models.PROTECT, related_name="likes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("user", "video"), name="unique_video_like")]


class Cookbook(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=150)
    description = models.CharField(max_length=2000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("created_at", "id")


class CookbookItem(models.Model):
    cookbook = models.ForeignKey(Cookbook, on_delete=models.CASCADE, related_name="items")
    video = models.ForeignKey("catalog.Video", on_delete=models.PROTECT)
    position = models.PositiveIntegerField()
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("position", "id")
        constraints = [
            models.UniqueConstraint(fields=("cookbook", "video"), name="unique_cookbook_video"),
            models.UniqueConstraint(
                fields=("cookbook", "position"),
                name="unique_cookbook_position",
                deferrable=models.Deferrable.DEFERRED,
            ),
        ]
