import httpx

urls = [
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGOylcvW_v6zuCvld0FOgPWuCqCZaC1WyK7IcaKQsM4TC00CUbplOjeepqa0E_q_ByifZ9GPVtxJUy_1U1LOfDO9qnoojZ4sDfnC8IjE7a-JAFjnAKVtDO3ARpfvpdoA68=",
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGVsC_zPVqfqi_CZasOAbDI1rUytYC7HbZzJ9FFU9c9J5GAWE20ITPjB6iocJ6L-6Cxb-P553wjc0FQvm_9S0O5f5QD_ibInnuL1VqRUOSI3meOKV1V0WKn7jG3DGExG4Q=",
]

for u in urls:
    try:
        r = httpx.get(u, follow_redirects=False, timeout=5)
        print("Redirect:", r.headers.get("location"))
    except Exception as e:
        print("Error:", e)
