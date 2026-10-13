"""Resolve the maintained Vite entry, including imported styles and module preloads."""

import json

from django.conf import settings


def vite_assets():
    if settings.VITE_DEV_SERVER:
        origin = settings.VITE_DEV_SERVER.rstrip("/")
        return {"dev": origin, "entry": f"{origin}/src/main.jsx", "css": [], "imports": []}
    manifest = json.loads(settings.VITE_MANIFEST_PATH.read_text(encoding="utf-8"))
    entry = manifest["src/main.jsx"]
    styles, imports, seen = [], [], set()

    def visit(key):
        if key in seen:
            return
        seen.add(key)
        chunk = manifest[key]
        for child in chunk.get("imports", []):
            visit(child)
        for css in chunk.get("css", []):
            if css not in styles:
                styles.append(css)
        if key != "src/main.jsx":
            imports.append("/" + chunk["file"])

    visit("src/main.jsx")
    return {
        "dev": "",
        "entry": "/" + entry["file"],
        "css": ["/" + css for css in styles],
        "imports": imports,
    }
