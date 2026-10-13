from django.http import HttpResponse
from django.template.loader import render_to_string
from django.urls import reverse
from django.views.decorators.http import require_safe

from common.vite import vite_assets

from .public import conditional, public_video, published


@require_safe
def watch(request, slug):
    video = published().filter(slug=slug).first()
    if video is None:
        response = HttpResponse(
            "<!doctype html><title>Recipe not found</title><h1>Recipe not found</h1>"
            '<p>This recipe is not available in the archive.</p><a href="/">Discover recipes</a>',
            status=404,
        )
        response["Cache-Control"] = "no-store"
        return response
    data = public_video(video)
    canonical = request.build_absolute_uri(reverse("watch", args=(video.slug,)))
    # Do not pass request or use auth/session/CSRF context processors in public HTML.
    html = render_to_string(
        "catalog/watch.html",
        {
            "video": data,
            "canonical": canonical,
            "vite": vite_assets(),
        },
    )
    return conditional(request, HttpResponse(html))
