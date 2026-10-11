from urllib.parse import urlencode

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html

from integrations.youtube import YouTubeAPIError, normalize_youtube_url

from .forms import VideoAdminForm
from .models import EditorialPolicy, Video, VideoIngredient
from .services import (
    apply_source_snapshot,
    hide_video,
    preview_source,
    publish_video,
    purge_expired_source_metadata,
    read_source_metadata,
    refresh_video,
    require_permission,
    source_values,
)


class PreviewForm(forms.Form):
    source_url = forms.CharField(label="YouTube source URL")


class VideoIngredientInline(admin.TabularInline):
    model = VideoIngredient
    extra = 1

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "ingredient":
            kwargs["queryset"] = db_field.related_model.objects.filter(canonical__isnull=True)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


@admin.register(Video)
class VideoAdmin(admin.ModelAdmin):
    form = VideoAdminForm
    inlines = (VideoIngredientInline,)
    change_list_template = "admin/catalog/video/change_list.html"
    list_display = (
        "recipe_name",
        "external_id",
        "status",
        "current_availability",
        "last_sync_error",
    )
    list_filter = ("status", "availability", "diet", "last_sync_error")
    search_fields = ("recipe_name", "external_id", "slug")
    filter_horizontal = ("cuisines", "meal_types")
    readonly_fields = (
        "slug",
        "status",
        "source_preview",
        "external_id",
        "canonical_url",
        "last_metadata_sync_at",
        "last_sync_error",
        "sync_failure_count",
        "reviewed_by",
        "reviewed_at",
        "added_by",
        "created_at",
        "updated_at",
    )
    actions = ("review_and_publish", "hide_selected", "refresh_selected")

    class Media:
        css = {"all": ("catalog/preview.css",)}

    def get_queryset(self, request):
        purge_expired_source_metadata()
        return super().get_queryset(request)

    def get_fieldsets(self, request, obj=None):
        source = (
            (
                "source_preview",
                "external_id",
                "canonical_url",
                "last_metadata_sync_at",
                "last_sync_error",
                "sync_failure_count",
            )
            if obj
            else ("source_url",)
        )
        return (
            ("Source", {"fields": source}),
            (
                "Recipe details",
                {
                    "fields": (
                        "recipe_name",
                        "recipe_summary",
                        "language",
                        "cook_time_minutes",
                        "difficulty",
                    )
                },
            ),
            (
                "Categories and dietary info",
                {
                    "fields": (
                        "diet",
                        "cuisines",
                        "meal_types",
                        "diet_reviewed",
                        "air_fryer_confirmed",
                    )
                },
            ),
            (
                "Publication status",
                {
                    "fields": (
                        "status",
                        "slug",
                        "reviewed_by",
                        "reviewed_at",
                        "added_by",
                        "created_at",
                        "updated_at",
                    )
                },
            ),
        )

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        form.request_user = request.user
        return form

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        kwargs["queryset"] = db_field.related_model.objects.filter(canonical__isnull=True)
        return super().formfield_for_manytomany(db_field, request, **kwargs)

    def get_urls(self):
        return [
            path(
                "preview/",
                self.admin_site.admin_view(self.preview_view),
                name="catalog_video_preview",
            )
        ] + super().get_urls()

    def get_changeform_initial_data(self, request):
        return {
            **super().get_changeform_initial_data(request),
            "source_url": request.GET.get("source_url", ""),
        }

    def preview_view(self, request):
        require_permission(request.user, "add_video")
        form = PreviewForm(request.POST if request.method == "POST" else None)
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": "Preview a YouTube source",
            "form": form,
        }
        if request.method == "POST" and form.is_valid():
            try:
                result = preview_source(form.cleaned_data["source_url"], request.user)
                if result["existing"]:
                    existing = result["existing"]
                    context["duplicate"] = True
                    if self.has_view_permission(request, existing):
                        context["existing_url"] = reverse(
                            "admin:catalog_video_change", args=(existing.pk,)
                        )
                        context["source"] = read_source_metadata(existing)
                        context["original_url"] = existing.canonical_url
                else:
                    metadata = result["metadata"]
                    context["source"] = source_values(metadata, result["video_id"])
                    context["original_url"] = (
                        f"https://www.youtube.com/watch?v={result['video_id']}"
                    )
                    context["add_url"] = (
                        reverse("admin:catalog_video_add")
                        + "?"
                        + urlencode({"source_url": form.cleaned_data["source_url"]})
                    )
                if context.get("source", {}).get("embeddable") is True:
                    origin = f"{request.scheme}://{request.get_host()}"
                    context["embed_url"] = (
                        f"https://www.youtube-nocookie.com/embed/{result['video_id']}?"
                        + urlencode({"origin": origin, "playsinline": 1})
                    )
            except (ValueError, YouTubeAPIError, ValidationError) as exc:
                form.add_error("source_url", str(exc))
        return TemplateResponse(request, "admin/catalog/video/preview.html", context)

    def save_model(self, request, obj, form, change):
        require_permission(request.user, "change_video" if change else "add_video")
        if not change:
            obj.added_by = request.user
            obj.status = Video.Status.DRAFT
            apply_source_snapshot(
                obj, form.source_result["metadata"], form.source_result["fetched_at"]
            )
        elif form.changed_data:
            # A changed recipe must be deliberately reviewed again, including after publication.
            obj.status = Video.Status.DRAFT if obj.status == Video.Status.PUBLISHED else obj.status
            obj.reviewed_by = None
            obj.reviewed_at = None
        if change:
            # A form loaded before refresh must never save its stale source columns back.
            obj.save(
                update_fields=(
                    "recipe_name",
                    "recipe_summary",
                    "language",
                    "cook_time_minutes",
                    "difficulty",
                    "diet",
                    "diet_reviewed",
                    "air_fryer_confirmed",
                    "status",
                    "reviewed_by",
                    "reviewed_at",
                    "updated_at",
                )
            )
        else:
            super().save_model(request, obj, form, change)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if change and any(formset.has_changed() for formset in formsets):
            obj = form.instance
            if obj.status == Video.Status.PUBLISHED:
                obj.status = Video.Status.DRAFT
            obj.reviewed_by = None
            obj.reviewed_at = None
            obj.save(update_fields=("status", "reviewed_by", "reviewed_at", "updated_at"))

    def add_view(self, request, form_url="", extra_context=None):
        try:
            with transaction.atomic():
                return super().add_view(request, form_url, extra_context)
        except IntegrityError:
            try:
                video_id = normalize_youtube_url(request.POST.get("source_url", ""))
                existing = Video.objects.get(platform="YOUTUBE", external_id=video_id)
            except (ValueError, Video.DoesNotExist):
                raise
            self.message_user(
                request,
                "This source was added by another admin. No duplicate was saved.",
                messages.WARNING,
            )
            target = reverse("admin:catalog_video_changelist")
            if self.has_view_permission(request, existing):
                target = reverse("admin:catalog_video_change", args=(existing.pk,))
            return HttpResponseRedirect(target)

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Source availability")
    def current_availability(self, obj):
        return Video.Availability(read_source_metadata(obj)["availability"]).label

    @admin.display(description="Original metadata (not recipe details)")
    def source_preview(self, obj):
        source = read_source_metadata(obj)
        creator = source["creator_name"] or "Unknown"
        if source["creator_url"]:
            creator = format_html('<a href="{}">{}</a>', source["creator_url"], creator)
        thumbnail = ""
        if source["thumbnail_url"]:
            thumbnail = format_html(
                '<img class="source-thumbnail" src="{}" alt="Original source thumbnail">',
                source["thumbnail_url"],
            )
        return format_html(
            "<p>{}</p><p>Creator: {}</p><p>Video length: {} seconds</p><p>{}</p>{}",
            source["source_title"] or "Unknown source title",
            creator,
            source["duration_seconds"] if source["duration_seconds"] is not None else "Unknown",
            Video.Availability(source["availability"]).label,
            thumbnail,
        )

    def has_publish_permission(self, request):
        return self.has_change_permission(request) and request.user.has_perm(
            "catalog.publish_video"
        )

    def has_hide_permission(self, request):
        return self.has_change_permission(request) and request.user.has_perm("catalog.hide_video")

    def has_refresh_permission(self, request):
        return self.has_change_permission(request) and request.user.has_perm(
            "catalog.refresh_video"
        )

    def run_action(self, request, queryset, service, permission):
        require_permission(request.user, "change_video")
        require_permission(request.user, permission)
        count = 0
        # Manual operations are deliberately bounded; maintenance handles larger refresh sets.
        if queryset.count() > 50:
            self.message_user(request, "Select at most 50 records per action.", messages.ERROR)
            return
        for video_id in queryset.values_list("pk", flat=True):
            try:
                result = service(video_id, request.user)
                if result is False:
                    self.message_user(
                        request,
                        "Source refresh failed; see the sanitized sync error.",
                        messages.ERROR,
                    )
                else:
                    count += 1
                    self.log_change(
                        request, Video.objects.get(pk=video_id), "Editorial action completed."
                    )
            except ValidationError as exc:
                self.message_user(request, "; ".join(exc.messages), messages.ERROR)
            except PermissionDenied:
                raise
        self.message_user(request, f"Completed for {count} record(s).")

    @admin.action(permissions=("publish",), description="Review and publish selected recipes")
    def review_and_publish(self, request, queryset):
        self.run_action(request, queryset, publish_video, "publish_video")

    @admin.action(permissions=("hide",), description="Hide selected recipes")
    def hide_selected(self, request, queryset):
        self.run_action(request, queryset, hide_video, "hide_video")

    @admin.action(permissions=("refresh",), description="Refresh source metadata")
    def refresh_selected(self, request, queryset):
        self.run_action(request, queryset, refresh_video, "refresh_video")

    def construct_change_message(self, request, form, formsets, add=False):
        # Never copy source metadata or ingredient labels into durable admin history.
        return "Created draft." if add else "Edited recipe or taxonomy relations."


@admin.register(EditorialPolicy)
class EditorialPolicyAdmin(admin.ModelAdmin):
    fields = ("explanation", "updated_at")
    readonly_fields = ("updated_at",)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
