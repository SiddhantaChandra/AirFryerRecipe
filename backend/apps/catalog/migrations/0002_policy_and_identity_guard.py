from django.db import migrations

POLICY = (
    "Recipes containing eggs, meat, fish, or other non-vegetarian ingredients are Non-vegetarian "
    "(NON_VEG). Dairy without eggs or meat is Vegetarian (VEG). Recipes with no animal-derived "
    "ingredients are Vegan (VEGAN). Unclear ingredients or instructions remain Unknown (UNKNOWN) "
    "until manual review. Vegetarian discovery also includes Vegan recipes. Labels require human "
    "review; source titles alone do not establish dietary suitability."
)


def seed_policy(apps, schema_editor):
    apps.get_model("catalog", "EditorialPolicy").objects.get_or_create(
        id=1, defaults={"explanation": POLICY}
    )


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial")]
    operations = [
        migrations.RunPython(seed_policy, migrations.RunPython.noop),
        migrations.RunSQL(
            sql="""
            CREATE FUNCTION catalog_guard_video_identity() RETURNS trigger AS $$
            BEGIN
              IF NEW.slug IS DISTINCT FROM OLD.slug
                 OR NEW.platform IS DISTINCT FROM OLD.platform
                 OR NEW.external_id IS DISTINCT FROM OLD.external_id
                 OR NEW.canonical_url IS DISTINCT FROM OLD.canonical_url THEN
                RAISE EXCEPTION 'Video slug and source identity are immutable'
                  USING ERRCODE = '23514';
              END IF;
              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            CREATE TRIGGER catalog_video_identity_guard BEFORE UPDATE ON catalog_video
              FOR EACH ROW EXECUTE FUNCTION catalog_guard_video_identity();
            """,
            reverse_sql="""
            DROP TRIGGER catalog_video_identity_guard ON catalog_video;
            DROP FUNCTION catalog_guard_video_identity();
            """,
        ),
    ]
