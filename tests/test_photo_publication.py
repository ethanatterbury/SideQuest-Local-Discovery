"""Execute the actual workflow publishers against a racing local Git remote."""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ("venue-photos.yml", "geograph-photos.yml")
PHOTO = "src/providers/data/venue-photo-previews.json"
SOURCE = "src/providers/data/regions/england.json.gz"


def git(directory, *args):
    return subprocess.check_output(
        ["git", "-C", str(directory), *args], stderr=subprocess.STDOUT, text=True
    ).strip()


def publisher(workflow):
    text = (ROOT / ".github/workflows" / workflow).read_text()
    section = text.split("  publish:\n", 1)[1]
    return "\n".join(
        line[10:] for line in section.split("        run: |\n", 1)[1].splitlines()
    )


class PhotoPublicationTests(unittest.TestCase):
    def test_artifact_identity_comes_from_the_original_prepare_job(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow):
                text = (ROOT / ".github/workflows" / workflow).read_text()
                self.assertIn("candidate_artifact: ${{ steps.base.outputs.candidate_artifact }}", text)
                self.assertIn("name: ${{ steps.base.outputs.candidate_artifact }}", text)
                publish = text.split("  publish:\n", 1)[1]
                self.assertIn("name: ${{ needs.prepare.outputs.candidate_artifact }}", publish)
                self.assertNotIn("github.run_attempt", publish)

    def run_race(self, workflow, race_path, race_count=1):
        with tempfile.TemporaryDirectory(prefix="sidequest-publish-test-") as folder:
            folder = Path(folder)
            remote, seed = folder / "remote.git", folder / "seed"
            subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
            subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
            for directory in (seed,):
                git(directory, "config", "user.name", "Test")
                git(directory, "config", "user.email", "test@localhost")
            files = (PHOTO, SOURCE, "src/app.ts", "src/providers/data/venue-photo-search-ledger.json")
            for name in files:
                path = seed / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("original\n")
            git(seed, "add", ".")
            git(seed, "commit", "-m", "Verified application")
            base = git(seed, "rev-parse", "HEAD")
            git(seed, "remote", "add", "origin", str(remote))
            git(seed, "push", "origin", "HEAD:main")
            git(remote, "symbolic-ref", "HEAD", "refs/heads/main")
            publishing, writer = folder / "publisher", folder / "writer"
            for directory in (publishing, writer):
                subprocess.run(["git", "clone", str(remote), str(directory)], check=True, capture_output=True)
                git(directory, "config", "user.name", "Test")
                git(directory, "config", "user.email", "test@localhost")
            candidate = publishing / "work/photo-publication"
            candidate.mkdir(parents=True)
            for name in ("venue-photo-previews.json", "venue-photo-search-ledger.json"):
                (candidate / name).write_text("verified candidate\n")
            counter = folder / "race-count"
            hook = publishing / ".git/hooks/pre-push"
            hook.write_text(f'''#!/bin/sh
set -eu
count=0
if [ -f {shlex.quote(str(counter))} ]; then count=$(cat {shlex.quote(str(counter))}); fi
if [ "$count" -lt {race_count} ]; then
  count=$((count + 1))
  echo "$count" > {shlex.quote(str(counter))}
  echo "concurrent $count" > {shlex.quote(str(writer / race_path))}
  git -C {shlex.quote(str(writer))} add -- {shlex.quote(race_path)}
  git -C {shlex.quote(str(writer))} commit -m "Concurrent source update $count" >/dev/null
  git -C {shlex.quote(str(writer))} push origin HEAD:main
fi
''')
            hook.chmod(0o755)
            summary = folder / "summary.txt"
            result = subprocess.run(
                ["bash", "-e", "-o", "pipefail", "-c", publisher(workflow)],
                cwd=publishing,
                env={**os.environ, "VERIFIED_BASE_SHA": base, "GITHUB_STEP_SUMMARY": str(summary)},
                capture_output=True,
                text=True,
            )
            output = result.stdout + result.stderr
            remote_photo = git(remote, "show", f"refs/heads/main:{PHOTO}")
            if race_path == SOURCE and race_count == 1:
                self.assertEqual(result.returncode, 0, output)
                self.assertEqual(remote_photo, "verified candidate")
                self.assertEqual(git(remote, "show", f"refs/heads/main:{SOURCE}"), "concurrent 1")
                git(remote, "merge-base", "--is-ancestor", git(writer, "rev-parse", "HEAD"), "refs/heads/main")
            else:
                self.assertNotEqual(result.returncode, 0, output)
                self.assertEqual(remote_photo, "concurrent 1" if race_path == PHOTO else "original")
            self.assertEqual(int(counter.read_text()), race_count)
            self.assertNotIn("--force", publisher(workflow))
            if race_count == 3:
                self.assertIn("Main kept advancing", output)

    def test_independent_source_push_race_retries_without_losing_either_change(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow):
                self.run_race(workflow, SOURCE)

    def test_application_or_photo_data_races_require_new_preparation(self):
        for workflow in WORKFLOWS:
            for path in ("src/app.ts", PHOTO):
                with self.subTest(workflow=workflow, path=path):
                    self.run_race(workflow, path)

    def test_retries_stop_after_three_races(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow):
                self.run_race(workflow, SOURCE, 3)


if __name__ == "__main__":
    unittest.main()
