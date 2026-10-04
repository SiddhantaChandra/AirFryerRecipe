import os
import environ
from pathlib import Path
from youtube import fetch_youtube_metadata

env = environ.Env()
root_env = Path(__file__).resolve().parent.parent.parent / ".env"
env.read_env(str(root_env))

api_key = env("YOUTUBE_API_KEY")

test_id = "uLIOVZNFlPE"
res = fetch_youtube_metadata(test_id, api_key=api_key)
print("=== YouTube API Result for Real Short ===")
print("Found:", res.get("found"))
print("Title:", res.get("title"))
print("Channel:", res.get("channel_title"))
print("Duration (s):", res.get("duration_seconds"))
print("Duration ISO:", res.get("duration_iso"))
print("Embeddable:", res.get("embeddable"))
print("Privacy Status:", res.get("privacy_status"))
print("Thumbnails available:")
for k, v in res.get("thumbnails", {}).items():
    print(f"  - {k}: {v.get('width')}x{v.get('height')} -> {v.get('url')}")
