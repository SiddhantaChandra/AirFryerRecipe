from allauth.account.adapter import DefaultAccountAdapter
from allauth.headless.adapter import DefaultHeadlessAdapter


class AccountAdapter(DefaultAccountAdapter):
    def clean_email(self, email):
        return super().clean_email(email).strip().lower()

    def send_mail(self, *args, **kwargs):
        # Delivery is excluded. Fail closed if an unexpected flow attempts it.
        raise RuntimeError("Account email delivery is disabled.")

    def send_notification_mail(self, *args, **kwargs):
        # Finalization calls this hook even with notifications disabled.
        return None


class HeadlessAdapter(DefaultHeadlessAdapter):
    def serialize_user(self, user):
        return {
            "id": str(user.pk),
            "email": user.email,
            "name": user.name,
            "theme_preference": user.theme_preference,
        }
