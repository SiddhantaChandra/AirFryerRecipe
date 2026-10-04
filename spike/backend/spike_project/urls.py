from django.urls import path
from views import preview_video

urlpatterns = [
    path("api/preview/", preview_video, name="preview_video"),
]
