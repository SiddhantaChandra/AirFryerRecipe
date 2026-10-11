import json

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.catalog.maintenance import expiry_due, maintenance_lock


class Command(BaseCommand):
    help = "Purge expired source fields without changing editorial data or publication."

    def add_arguments(self, parser):
        parser.add_argument("--batch-size", type=int, default=500)

    def handle(self, *args, **options):
        if not 1 <= options["batch_size"] <= 1000:
            raise CommandError("Batch size must be 1..1000.")
        with maintenance_lock():
            purged = expiry_due(options["batch_size"])
        self.stdout.write(
            json.dumps({"purged": purged, "last_success": timezone.now().isoformat()})
        )
