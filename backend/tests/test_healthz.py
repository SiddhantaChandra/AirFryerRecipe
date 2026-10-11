from unittest.mock import patch

import pytest
from rest_framework.test import APIClient


@pytest.fixture
def client():
    return APIClient()


@pytest.mark.django_db
def test_healthz_returns_200_when_database_is_connected(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


@pytest.mark.django_db
def test_healthz_with_trailing_slash_returns_200(client):
    response = client.get("/healthz/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


def test_healthz_returns_503_when_database_fails(client):
    with patch("django.db.connection.cursor", side_effect=Exception("DB Down")):
        response = client.get("/healthz")
        assert response.status_code == 503
        assert response.json() == {"status": "unhealthy", "db": "unavailable"}
