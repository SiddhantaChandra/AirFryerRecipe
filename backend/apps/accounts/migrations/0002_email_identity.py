from django.db import migrations, models
from django.db.models.functions import Lower, Trim


def normalize_identities(apps, schema_editor):
    users = apps.get_model("accounts", "User").objects.using(schema_editor.connection.alias)
    collisions = (
        users.annotate(identity=Lower(Trim("email")))
        .values("identity")
        .annotate(total=models.Count("pk"))
        .filter(total__gt=1)
    )
    if collisions.exists():
        raise RuntimeError(
            "Normalized email collisions require owner resolution; no accounts were changed."
        )
    users.update(email=Lower(Trim("email")))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]
    operations = [
        migrations.RunPython(normalize_identities, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                Lower(Trim("email")), name="accounts_user_email_identity"
            ),
        ),
    ]
