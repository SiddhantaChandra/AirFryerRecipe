import uuid

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError

User = get_user_model()


@pytest.mark.django_db
class TestCustomUser:
    def test_create_user_successful(self):
        user = User.objects.create_user(
            email="chef@example.com",
            password="StrongPassword123!",
            name="Chef Gordon",
        )
        assert isinstance(user.id, uuid.UUID)
        assert user.email == "chef@example.com"
        assert user.name == "Chef Gordon"
        assert user.is_active is True
        assert user.is_staff is False
        assert user.is_superuser is False
        assert user.theme_preference == "system"
        assert user.check_password("StrongPassword123!") is True
        assert str(user) == "chef@example.com"

    def test_create_superuser_successful(self):
        admin = User.objects.create_superuser(
            email="admin@example.com",
            password="AdminPassword123!",
            name="Admin User",
        )
        assert isinstance(admin.id, uuid.UUID)
        assert admin.email == "admin@example.com"
        assert admin.is_staff is True
        assert admin.is_superuser is True
        assert admin.is_active is True

    def test_duplicate_email_raises_integrity_error(self):
        User.objects.create_user(email="duplicate@example.com", password="Password123!")
        with pytest.raises(IntegrityError):
            User.objects.create_user(email="duplicate@example.com", password="AnotherPassword123!")

    def test_empty_email_raises_value_error(self):
        with pytest.raises(ValueError):
            User.objects.create_user(email="", password="Password123!")
