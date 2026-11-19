"""Regression checks for the status-badge workflow's trust boundary (stdlib only).

Run: python -m unittest scripts/__tests__/status_badges_security_test.py
These verify source guards and exercises the equivalent branch-provenance predicate.
They are not an end-to-end GitHub-hosted event test.
"""
from pathlib import Path
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/status-badges.yml"


def allowed(event_name, ref, head_branch=None, head_repository=None):
    return ref == "refs/heads/main" and (
        event_name != "workflow_run"
        or (head_branch == "main" and head_repository == "clarkandwebbV10/ruflo")
    )


class BadgeSecurityTest(unittest.TestCase):
    def test_main_workflow_event_accepted(self):
        self.assertTrue(allowed("workflow_run", "refs/heads/main", "main", "clarkandwebbV10/ruflo"))

    def test_pr_workflow_event_rejected_even_with_main_ref(self):
        self.assertFalse(allowed("workflow_run", "refs/heads/main", "security/fix", "clarkandwebbV10/ruflo"))

    def test_fork_workflow_event_rejected(self):
        self.assertFalse(allowed("workflow_run", "refs/heads/main", "main", "untrusted/fork"))

    def test_push_to_nondefault_branch_rejected(self):
        self.assertFalse(allowed("push", "refs/heads/feature"))

    def test_legitimate_main_push_accepted(self):
        self.assertTrue(allowed("push", "refs/heads/main"))

    def test_guards_and_safe_shell_boundary_present(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("github.event.workflow_run.head_branch == 'main'", content)
        self.assertIn("github.event.workflow_run.head_repository.full_name == github.repository", content)
        self.assertIn("github.event_name != 'workflow_run'", content)
        self.assertIn("github.ref == 'refs/heads/main'", content)
        self.assertIn("VERIFICATION_STATUS: ${{ github.event.workflow_run.conclusion || 'unknown' }}", content)
        self.assertIn("WORKFLOW_NAME: ${{ github.event.workflow_run.name || 'unknown' }}", content)
        self.assertNotIn('VERIFICATION_STATUS="${{', content)
        self.assertNotIn('WORKFLOW_NAME="${{', content)
        self.assertIn("cancel-in-progress: true", content)
        self.assertIn("contents: write", content)


if __name__ == "__main__":
    unittest.main()
