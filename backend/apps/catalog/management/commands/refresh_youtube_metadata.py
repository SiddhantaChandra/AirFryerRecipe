import json

from django.core.management.base import BaseCommand, CommandError

from apps.catalog.maintenance import maintenance_lock, refresh_due


class Command(BaseCommand):
    help = "Refresh source metadata due at day 25; bounded batches, retries and request budget."

    def add_arguments(self, parser):
        parser.add_argument("--batch-size", type=int, default=50)
        parser.add_argument("--max-requests", type=int, default=100)
        parser.add_argument("--retries", type=int, default=2)

    def handle(self, *args, **options):
        if not 1 <= options["batch_size"] <= 50 or not 1 <= options["max_requests"] <= 100:
            raise CommandError("Batch size must be 1..50; request budget must be 1..100.")
        if not 0 <= options["retries"] <= 2:
            raise CommandError("Retries must be 0..2.")
        with maintenance_lock():
            result = refresh_due(options["batch_size"], options["max_requests"], options["retries"])
        self.stdout.write(json.dumps(result))
