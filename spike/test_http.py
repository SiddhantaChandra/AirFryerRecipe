import httpx

# 1. Test Vite Dev Server
r1 = httpx.get("http://127.0.0.1:5173/")
print("1. Vite root HTTP Status:", r1.status_code)
assert r1.status_code == 200

# 2. Test Django directly
r2 = httpx.post("http://127.0.0.1:8000/api/preview/", json={"url": "https://www.youtube.com/shorts/uLIOVZNFlPE"})
print("2. Django Direct preview HTTP Status:", r2.status_code)
assert r2.status_code == 200
data_django = r2.json()
print("   Title:", data_django.get("title"))
print("   Embeddable:", data_django.get("embeddable"))

# 3. Test Vite Proxy to Django (/api/preview/)
r3 = httpx.post("http://127.0.0.1:5173/api/preview/", json={"url": "https://www.youtube.com/shorts/uLIOVZNFlPE"})
print("3. Vite Proxy preview HTTP Status:", r3.status_code)
assert r3.status_code == 200
data_proxy = r3.json()
print("   Title via Proxy:", data_proxy.get("title"))

# 4. Test Error handling via Proxy (Bad domain)
r4 = httpx.post("http://127.0.0.1:5173/api/preview/", json={"url": "https://attacker.com/shorts/uLIOVZNFlPE"})
print("4. Malicious URL rejection HTTP Status:", r4.status_code, "Error:", r4.json().get("error"))
assert r4.status_code == 400

# 5. Test Unavailable video
r5 = httpx.post("http://127.0.0.1:5173/api/preview/", json={"url": "https://www.youtube.com/watch?v=00000000000"})
print("5. Unavailable video HTTP Status:", r5.status_code, "Found:", r5.json().get("found"))
assert r5.status_code == 200
assert r5.json().get("found") is False

print("\nALL HTTP & PROXY CHECKS PASSED!")
