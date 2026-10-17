import uuid

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.db.models.functions import Lower, Trim
from django.utils import timezone


class UserManager(BaseUserManager):
    @classmethod
    def normalize_email(cls, email):
        return (email or "").strip().lower()

    def create_user(self, email, password=None, **extra_fields):
        email = self.normalize_email(email)
        if not email:
            raise ValueError("The Email field must be set.")
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        user = self.model(email=email, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    THEME_CHOICES = (
        ("light", "Light"),
        ("dark", "Dark"),
        ("system", "System"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, db_index=True)
    name = models.CharField(max_length=150, blank=True, default="")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)
    theme_preference = models.CharField(max_length=20, choices=THEME_CHOICES, default="system")
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        db_table = "accounts_user"
        verbose_name = "User"
        verbose_name_plural = "Users"
        constraints = [
            models.UniqueConstraint(Lower(Trim("email")), name="accounts_user_email_identity"),
        ]

    def __str__(self):
        return self.email
