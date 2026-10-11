from django.contrib import admin

from .models import Cuisine, Ingredient, MealType


class VocabularyAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "canonical")
    search_fields = ("name", "aliases__name")
    readonly_fields = ("slug",)
    list_filter = ("canonical",)

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "canonical":
            kwargs["queryset"] = self.model.objects.filter(canonical__isnull=True)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def has_delete_permission(self, request, obj=None):
        return False


for model in (Cuisine, Ingredient, MealType):
    admin.site.register(model, VocabularyAdmin)
