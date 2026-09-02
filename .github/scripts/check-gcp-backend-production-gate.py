#!/usr/bin/env python3
"""Fail-closed GitHub release gate for a SIMSA production backend release.

The script deliberately uses only ``GITHUB_TOKEN`` and the GitHub REST API. It
does not accept a PAT and never writes the token to release evidence.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


API_VERSION = "2026-03-10"


class GateFailure(RuntimeError):
    """A production release prerequisite was not satisfied."""


@dataclass(frozen=True)
class RequiredResult:
    context: str
    app_id: int | None
    sources: tuple[str, ...]


class GitHubApi:
    def __init__(self, token: str, api_url: str = "https://api.github.com") -> None:
        if not token:
            raise GateFailure("GITHUB_TOKEN is required")
        self._token = token
        self._api_url = api_url.rstrip("/")

    def get(self, path: str, *, paginate_key: str | None = None) -> Any:
        page = 1
        collected: list[Any] = []
        while True:
            separator = "&" if "?" in path else "?"
            paged_path = f"{path}{separator}per_page=100&page={page}"
            request = urllib.request.Request(
                f"{self._api_url}{paged_path}",
                headers={
                    "Accept": "application/vnd.github+json",
                    "Authorization": f"Bearer {self._token}",
                    "X-GitHub-Api-Version": API_VERSION,
                    "User-Agent": "simsa-gcp-backend-release-gate",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:500]
                raise GateFailure(
                    f"GitHub API GET {path} failed with HTTP {error.code}: {detail}"
                ) from error
            except (urllib.error.URLError, TimeoutError) as error:
                raise GateFailure(f"GitHub API GET {path} failed: {error}") from error

            if paginate_key is None:
                return payload

            if not isinstance(payload, dict) or not isinstance(payload.get(paginate_key), list):
                raise GateFailure(f"Unexpected paginated GitHub response for {path}")
            batch = payload[paginate_key]
            collected.extend(batch)
            if len(batch) < 100:
                return collected
            page += 1

    def get_list(self, path: str) -> list[Any]:
        page = 1
        collected: list[Any] = []
        while True:
            separator = "&" if "?" in path else "?"
            request = urllib.request.Request(
                f"{self._api_url}{path}{separator}per_page=100&page={page}",
                headers={
                    "Accept": "application/vnd.github+json",
                    "Authorization": f"Bearer {self._token}",
                    "X-GitHub-Api-Version": API_VERSION,
                    "User-Agent": "simsa-gcp-backend-release-gate",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:500]
                raise GateFailure(
                    f"GitHub API GET {path} failed with HTTP {error.code}: {detail}"
                ) from error
            except (urllib.error.URLError, TimeoutError) as error:
                raise GateFailure(f"GitHub API GET {path} failed: {error}") from error
            if not isinstance(payload, list):
                raise GateFailure(f"Unexpected list response from GitHub for {path}")
            collected.extend(payload)
            if len(payload) < 100:
                return collected
            page += 1

    def get_optional(self, path: str) -> Any | None:
        try:
            return self.get(path)
        except GateFailure as error:
            # GITHUB_TOKEN may read branch/check data but not repository
            # administration endpoints. A 403/404 means the richer protection
            # payload is unavailable; network/5xx failures still block.
            message = str(error)
            if "HTTP 403:" in message or "HTTP 404:" in message:
                return None
            raise


def _required_checks(branch: dict[str, Any]) -> list[tuple[str, int | None]]:
    if branch.get("protected") is not True:
        raise GateFailure("The default branch is not protected")
    protection = branch.get("protection") or {}
    required = protection.get("required_status_checks") or {}
    required_contexts = {
        str(value).strip()
        for value in (required.get("contexts") or [])
        if str(value).strip()
    }
    result: dict[str, int] = {}
    for check in required.get("checks") or []:
        context = str(check.get("context") or "").strip()
        if not context:
            continue
        raw_app_id = check.get("app_id")
        if not isinstance(raw_app_id, int) or raw_app_id <= 0:
            raise GateFailure(
                f"Required check {context!r} is not bound to one trusted GitHub App; "
                "production release is blocked"
            )
        app_id = int(raw_app_id)
        existing = result.get(context)
        if existing is not None and existing != app_id:
            raise GateFailure(
                f"Required check {context!r} has ambiguous GitHub App bindings"
            )
        result[context] = app_id

    all_contexts = required_contexts | set(result)
    if not all_contexts:
        raise GateFailure(
            "The protected default branch exposes no required status-check contexts; "
            "production release is blocked"
        )
    missing_app_bindings = sorted(all_contexts - set(result))
    if missing_app_bindings:
        raise GateFailure(
            "Required checks lack an authenticated GitHub App binding: "
            + ", ".join(missing_app_bindings)
            + ". The release gate never accepts same-name legacy commit statuses."
        )
    return sorted(result.items())


def _validate_required_results(
    required_checks: list[tuple[str, int | None]],
    check_runs: list[dict[str, Any]],
    statuses: list[dict[str, Any]],
) -> list[RequiredResult]:
    validated: list[RequiredResult] = []
    failures: list[str] = []

    for context, app_id in required_checks:
        matching_checks = [
            run
            for run in check_runs
            if run.get("name") == context
            and (app_id is None or int((run.get("app") or {}).get("id") or -1) == app_id)
        ]
        # An app-bound required check cannot be satisfied by an unbound legacy
        # commit status with the same display context.
        matching_statuses = (
            [status for status in statuses if status.get("context") == context]
            if app_id is None
            else []
        )
        sources: list[str] = []

        if matching_checks:
            conclusions = [str(run.get("conclusion") or run.get("status") or "missing") for run in matching_checks]
            sources.extend(f"check-run:{value}" for value in conclusions)
            if any(value != "success" for value in conclusions):
                failures.append(f"{context} check-run conclusions={conclusions}")

        if matching_statuses:
            # The statuses endpoint is newest-first. A stale historical failure must
            # not override the latest status for the same context.
            latest_state = str(matching_statuses[0].get("state") or "missing")
            sources.append(f"commit-status:{latest_state}")
            if latest_state != "success":
                failures.append(f"{context} commit status={latest_state}")

        if not sources:
            failures.append(f"{context} is missing")
        elif not any(source.endswith(":success") for source in sources):
            failures.append(f"{context} has no successful result")

        validated.append(RequiredResult(context=context, app_id=app_id, sources=tuple(sources)))

    if failures:
        raise GateFailure("Required checks are not all successful: " + "; ".join(failures))
    return validated


def _validate_reviews(
    pull: dict[str, Any],
    reviews: list[dict[str, Any]],
    required_count: int,
) -> dict[str, Any]:
    author = str((pull.get("user") or {}).get("login") or "").strip()
    head_sha = str((pull.get("head") or {}).get("sha") or "").lower()
    if not author or len(head_sha) != 40:
        raise GateFailure("Merged pull request author or reviewed head SHA is missing")
    if required_count < 1:
        required_count = 1

    # COMMENTED reviews do not revoke an existing approval. APPROVED,
    # CHANGES_REQUESTED, and DISMISSED are decisive states; the latest decisive
    # state per reviewer is the effective review state.
    decisive = {"APPROVED", "CHANGES_REQUESTED", "DISMISSED"}
    latest_by_reviewer: dict[str, dict[str, Any]] = {}
    ordered = sorted(
        reviews,
        key=lambda review: (
            str(review.get("submitted_at") or ""),
            int(review.get("id") or 0),
        ),
    )
    for review in ordered:
        state = str(review.get("state") or "").upper()
        reviewer = review.get("user") or {}
        login = str(reviewer.get("login") or "").strip()
        if state not in decisive or not login:
            continue
        latest_by_reviewer[login.casefold()] = review

    approved: list[str] = []
    for review in latest_by_reviewer.values():
        reviewer = review.get("user") or {}
        login = str(reviewer.get("login") or "").strip()
        state = str(review.get("state") or "").upper()
        reviewed_commit = str(review.get("commit_id") or "").lower()
        if (
            state == "APPROVED"
            and login.casefold() != author.casefold()
            and str(reviewer.get("type") or "") == "User"
            and reviewed_commit == head_sha
        ):
            approved.append(login)

    approved = sorted(set(approved), key=str.casefold)
    if len(approved) < required_count:
        raise GateFailure(
            f"PR #{pull.get('number')} has {len(approved)} effective human approval(s) "
            f"from non-authors on the final head; {required_count} required"
        )
    return {
        "pull_request": int(pull["number"]),
        "author": author,
        "reviewed_head_sha": head_sha,
        "required_approval_count": required_count,
        "approved_reviewers": approved,
    }


def evaluate_gate(
    *,
    repository: str,
    default_branch: str,
    commit_sha: str,
    branch: dict[str, Any],
    commit: dict[str, Any],
    pull_requests: list[dict[str, Any]],
    reviews_by_pull: dict[int, list[dict[str, Any]]],
    check_runs: list[dict[str, Any]],
    statuses: list[dict[str, Any]],
) -> dict[str, Any]:
    branch_head = str((branch.get("commit") or {}).get("sha") or "").lower()
    if branch_head != commit_sha:
        raise GateFailure(
            f"Production SHA {commit_sha} is not current {default_branch} HEAD {branch_head or '<missing>'}"
        )

    parents = commit.get("parents") or []
    if len(parents) < 2:
        raise GateFailure("Production SHA is not a merge commit (at least two parents required)")

    merged_pull_requests = [
        pull
        for pull in pull_requests
        if str(pull.get("merge_commit_sha") or "").lower() == commit_sha
        and pull.get("merged_at")
        and (pull.get("base") or {}).get("ref") == default_branch
    ]
    if not merged_pull_requests:
        raise GateFailure("No merged pull request targets the default branch with this exact merge SHA")
    if len(merged_pull_requests) != 1:
        raise GateFailure("The exact production merge SHA must resolve to one unambiguous merged pull request")

    review_protection = (branch.get("protection") or {}).get("required_pull_request_reviews") or {}
    required_count_source = (
        "branch_protection"
        if "required_approving_review_count" in review_protection
        else "fail_closed_minimum"
    )
    raw_required_count = review_protection.get("required_approving_review_count", 1)
    try:
        required_approval_count = max(1, int(raw_required_count))
    except (TypeError, ValueError) as error:
        raise GateFailure("Invalid required approving-review count in branch protection") from error
    pull = merged_pull_requests[0]
    pull_number = int(pull["number"])
    review_evidence = _validate_reviews(
        pull,
        reviews_by_pull.get(pull_number, []),
        required_approval_count,
    )
    review_evidence["required_approval_count_source"] = required_count_source

    required_checks = _required_checks(branch)
    results = _validate_required_results(required_checks, check_runs, statuses)

    return {
        "gate": "passed",
        "repository": repository,
        "default_branch": default_branch,
        "commit_sha": commit_sha,
        "merge_parent_count": len(parents),
        "pull_request_review": review_evidence,
        "required_results": [
            {"context": result.context, "app_id": result.app_id, "sources": list(result.sources)}
            for result in results
        ],
    }


def run_self_test() -> None:
    sha = "a" * 40
    base = {
        "repository": "example/simsa",
        "default_branch": "main",
        "commit_sha": sha,
        "branch": {
            "protected": True,
            "commit": {"sha": sha},
            "protection": {
                "required_status_checks": {
                    "contexts": ["CI / backend", "security"],
                    "checks": [
                        {"context": "CI / backend", "app_id": 123},
                        {"context": "security", "app_id": 123},
                    ],
                }
            },
        },
        "commit": {"parents": [{"sha": "1" * 40}, {"sha": "2" * 40}]},
        "pull_requests": [
            {
                "number": 42,
                "merge_commit_sha": sha,
                "merged_at": "2026-08-30T00:00:00Z",
                "base": {"ref": "main"},
                "user": {"login": "author", "type": "User"},
                "head": {"sha": "3" * 40},
            }
        ],
        "reviews_by_pull": {
            42: [
                {
                    "id": 7,
                    "state": "APPROVED",
                    "submitted_at": "2026-08-29T00:00:00Z",
                    "commit_id": "3" * 40,
                    "user": {"login": "reviewer", "type": "User"},
                }
            ]
        },
        "check_runs": [
            {"name": "CI / backend", "conclusion": "success", "app": {"id": 123}},
            {"name": "security", "conclusion": "success", "app": {"id": 123}},
        ],
        "statuses": [],
    }
    assert evaluate_gate(**base)["gate"] == "passed"

    broken = dict(base)
    broken["check_runs"] = [
        base["check_runs"][0],
        {"name": "security", "conclusion": "failure", "app": {"id": 123}},
    ]
    try:
        evaluate_gate(**broken)
    except GateFailure:
        pass
    else:
        raise AssertionError("A failed required check run was accepted")

    unbound_spoof = dict(base)
    unbound_spoof["branch"] = json.loads(json.dumps(base["branch"]))
    unbound_spoof["branch"]["protection"]["required_status_checks"] = {
        "contexts": ["CI / backend", "security"]
    }
    unbound_spoof["check_runs"] = []
    unbound_spoof["statuses"] = [
        {"context": "CI / backend", "state": "success"},
        {"context": "security", "state": "success"},
    ]
    try:
        evaluate_gate(**unbound_spoof)
    except GateFailure:
        pass
    else:
        raise AssertionError("Unbound required checks were satisfied by spoofable commit statuses")

    author_only = dict(base)
    author_only["reviews_by_pull"] = {
        42: [
            {
                "id": 8,
                "state": "APPROVED",
                "submitted_at": "2026-08-29T00:00:00Z",
                "commit_id": "3" * 40,
                "user": {"login": "author", "type": "User"},
            }
        ]
    }
    try:
        evaluate_gate(**author_only)
    except GateFailure:
        pass
    else:
        raise AssertionError("An author-only approval was accepted")

    revoked = dict(base)
    revoked["reviews_by_pull"] = {
        42: [
            {
                "id": 9,
                "state": "APPROVED",
                "submitted_at": "2026-08-28T00:00:00Z",
                "commit_id": "3" * 40,
                "user": {"login": "reviewer", "type": "User"},
            },
            {
                "id": 10,
                "state": "CHANGES_REQUESTED",
                "submitted_at": "2026-08-29T00:00:00Z",
                "commit_id": "3" * 40,
                "user": {"login": "reviewer", "type": "User"},
            },
        ]
    }
    try:
        evaluate_gate(**revoked)
    except GateFailure:
        pass
    else:
        raise AssertionError("A revoked approval was accepted")

    two_required = dict(base)
    two_required["branch"] = json.loads(json.dumps(base["branch"]))
    two_required["branch"]["protection"]["required_pull_request_reviews"] = {
        "required_approving_review_count": 2
    }
    try:
        evaluate_gate(**two_required)
    except GateFailure:
        pass
    else:
        raise AssertionError("Branch protection's required approval count was ignored")
    two_required["reviews_by_pull"] = {
        42: [
            *base["reviews_by_pull"][42],
            {
                "id": 11,
                "state": "APPROVED",
                "submitted_at": "2026-08-29T01:00:00Z",
                "commit_id": "3" * 40,
                "user": {"login": "second-reviewer", "type": "User"},
            },
        ]
    }
    assert evaluate_gate(**two_required)["pull_request_review"]["required_approval_count"] == 2

    app_bound = dict(base)
    app_bound["branch"] = json.loads(json.dumps(base["branch"]))
    app_bound["branch"]["protection"]["required_status_checks"]["checks"] = [
        {"context": "CI / backend", "app_id": 123},
        {"context": "security", "app_id": 123},
    ]
    app_bound["check_runs"] = [
        {"name": "CI / backend", "conclusion": "success", "app": {"id": 999}},
        base["check_runs"][1],
    ]
    try:
        evaluate_gate(**app_bound)
    except GateFailure:
        pass
    else:
        raise AssertionError("An app-bound required check was satisfied by the wrong GitHub App")
    app_bound["check_runs"] = [
        {"name": "CI / backend", "conclusion": "success", "app": {"id": 123}},
        base["check_runs"][1],
    ]
    assert evaluate_gate(**app_bound)["gate"] == "passed"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository")
    parser.add_argument("--default-branch")
    parser.add_argument("--commit-sha")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        run_self_test()
        print("production gate self-test: ok")
        return 0

    if not all((args.repository, args.default_branch, args.commit_sha, args.evidence)):
        raise GateFailure("repository, default branch, commit SHA, and evidence path are required")
    commit_sha = args.commit_sha.strip().lower()
    if len(commit_sha) != 40 or any(value not in "0123456789abcdef" for value in commit_sha):
        raise GateFailure("commit SHA must be exactly 40 hexadecimal characters")

    api = GitHubApi(os.environ.get("GITHUB_TOKEN", ""), os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    encoded_branch = urllib.parse.quote(args.default_branch, safe="")
    branch = api.get(f"/repos/{args.repository}/branches/{encoded_branch}")
    detailed_protection = api.get_optional(
        f"/repos/{args.repository}/branches/{encoded_branch}/protection"
    )
    if isinstance(detailed_protection, dict):
        branch = dict(branch)
        branch["protection"] = detailed_protection
    commit = api.get(f"/repos/{args.repository}/commits/{commit_sha}")
    associated_pull_requests = api.get_list(f"/repos/{args.repository}/commits/{commit_sha}/pulls")
    matching_numbers = sorted(
        {
            int(pull["number"])
            for pull in associated_pull_requests
            if str(pull.get("merge_commit_sha") or "").lower() == commit_sha
            and pull.get("merged_at")
            and (pull.get("base") or {}).get("ref") == args.default_branch
        }
    )
    pull_requests = [api.get(f"/repos/{args.repository}/pulls/{number}") for number in matching_numbers]
    reviews_by_pull = {
        number: api.get_list(f"/repos/{args.repository}/pulls/{number}/reviews")
        for number in matching_numbers
    }
    check_runs = api.get(
        f"/repos/{args.repository}/commits/{commit_sha}/check-runs?filter=latest",
        paginate_key="check_runs",
    )
    statuses = api.get_list(f"/repos/{args.repository}/commits/{commit_sha}/statuses")

    evidence = evaluate_gate(
        repository=args.repository,
        default_branch=args.default_branch,
        commit_sha=commit_sha,
        branch=branch,
        commit=commit,
        pull_requests=pull_requests,
        reviews_by_pull=reviews_by_pull,
        check_runs=check_runs,
        statuses=statuses,
    )
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Production release gate passed for {commit_sha}: "
        f"{len(evidence['required_results'])} required contexts successful"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GateFailure as error:
        print(f"production release gate: {error}", file=sys.stderr)
        raise SystemExit(1) from error
