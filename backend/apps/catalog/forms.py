from django import forms

from integrations.youtube import YouTubeAPIError

from .models import Video
from .services import preview_source


class VideoAdminForm(forms.ModelForm):
    source_url = forms.CharField(label="YouTube source URL", required=False)

    class Meta:
        model = Video
        fields = (
            "recipe_name",
            "recipe_summary",
            "diet",
            "language",
            "cook_time_minutes",
            "difficulty",
            "diet_reviewed",
            "air_fryer_confirmed",
            "cuisines",
            "meal_types",
        )

    def clean(self):
        cleaned = super().clean()
        if self.instance._state.adding:
            url = cleaned.get("source_url")
            if not url:
                self.add_error("source_url", "Enter a YouTube source URL.")
                return cleaned
            try:
                result = preview_source(url, self.request_user)
            except (ValueError, YouTubeAPIError) as exc:
                self.add_error("source_url", str(exc))
                return cleaned
            if result["existing"]:
                self.add_error(
                    "source_url", "This source is already in the archive. Use Preview to open it."
                )
                return cleaned
            self.instance.external_id = result["video_id"]
            self.source_result = result
        return cleaned
