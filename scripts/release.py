#!/usr/bin/env python3
"""Release script for AutoGLM-GUI.

This script automates the release process:
1. Bumps the version in pyproject.toml
2. Commits the change with git
3. Creates a git tag for the new version

Usage:
    uv run python scripts/release.py              # Bump patch version (0.1.3 -> 0.1.4)
    uv run python scripts/release.py --minor      # Bump minor version (0.1.3 -> 0.2.0)
    uv run python scripts/release.py --major      # Bump major version (0.1.3 -> 1.0.0)
    uv run python scripts/release.py --version 1.2.3  # Set specific version
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
PYPROJECT_PATH = ROOT_DIR / "pyproject.toml"


def get_current_version() -> str:
    """Extract current version from pyproject.toml."""
    if not PYPROJECT_PATH.exists():
        print(f"Error: {PYPROJECT_PATH} not found.")
        sys.exit(1)

    content = PYPROJECT_PATH.read_text()
    match = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)

    if not match:
        print("Error: Could not find version in pyproject.toml")
        sys.exit(1)

    return match.group(1)


def parse_version(version: str) -> tuple[int, int, int]:
    """Parse version string into (major, minor, patch) tuple."""
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)$", version)
    if not match:
        print(f"Error: Invalid version format: {version}")
        sys.exit(1)

    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def bump_version(
    current: str, bump_type: str = "patch", target_version: str | None = None
) -> str:
    """Bump version number based on bump type or return target version."""
    if target_version:
        parse_version(target_version)
        return target_version

    major, minor, patch = parse_version(current)

    if bump_type == "major":
        return f"{major + 1}.0.0"
    elif bump_type == "minor":
        return f"{major}.{minor + 1}.0"
    elif bump_type == "patch":
        return f"{major}.{minor}.{patch + 1}"
    else:
        print(f"Error: Invalid bump type: {bump_type}")
        sys.exit(1)


def update_pyproject_version(new_version: str) -> bool:
    """Update version in pyproject.toml."""
    print(f"Updating pyproject.toml to version {new_version}...")

    content = PYPROJECT_PATH.read_text()
    new_content = re.sub(
        r'^version\s*=\s*"[^"]+"',
        f'version = "{new_version}"',
        content,
        flags=re.MULTILINE,
    )

    if content == new_content:
        print("Error: Failed to update version in pyproject.toml")
        return False

    PYPROJECT_PATH.write_text(new_content)
    print(f'Updated pyproject.toml: version = "{new_version}"')
    return True


def git_commit_version(version: str, dry_run: bool = False) -> bool:
    """Commit pyproject.toml with version bump."""
    print("Committing version bump to git...")

    if dry_run:
        print("[DRY RUN] Would run: git add pyproject.toml")
        print(f'[DRY RUN] Would run: git commit -m "release v{version}"')
        return True

    try:
        # Stage pyproject.toml
        result = subprocess.run(
            ["git", "add", "pyproject.toml", "uv.lock"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            print(f"Error staging pyproject.toml: {result.stderr}")
            return False

        # Commit the change
        result = subprocess.run(
            ["git", "commit", "-m", f"release v{version}"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            print(f"Error creating commit: {result.stderr}")
            return False

        print(f"Committed: release v{version}")
        return True

    except Exception as e:
        print(f"Error: {e}")
        return False


def create_git_tag(version: str, dry_run: bool = False) -> bool:
    """Create git tag."""
    tag_name = f"v{version}"

    print(f"Creating git tag: {tag_name}...")

    if dry_run:
        print(f"[DRY RUN] Would create tag: {tag_name}")
        return True

    try:
        result = subprocess.run(
            ["git", "tag", "-a", tag_name, "-m", f"release {tag_name}"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            print(f"Error creating tag: {result.stderr}")
            return False

        print(f"Created tag: {tag_name}")
        return True

    except Exception as e:
        print(f"Error: {e}")
        return False


def run_uv_sync() -> bool:
    """Run uv sync to synchronize dependencies."""
    print("Running uv sync...")

    try:
        result = subprocess.run(
            ["uv", "sync"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            print(f"Error running uv sync: {result.stderr}")
            return False

        print("Dependencies synchronized successfully.")
        return True

    except Exception as e:
        print(f"Error: {e}")
        return False


def main() -> int:
    """Main release process."""
    parser = argparse.ArgumentParser(
        description="Release AutoGLM-GUI with version bump"
    )
    bump_group = parser.add_mutually_exclusive_group()
    bump_group.add_argument(
        "--major", action="store_true", help="Bump major version (X.0.0)"
    )
    bump_group.add_argument(
        "--minor", action="store_true", help="Bump minor version (x.X.0)"
    )
    bump_group.add_argument(
        "--patch", action="store_true", help="Bump patch version (x.x.X) [default]"
    )
    bump_group.add_argument(
        "--version", type=str, help="Set specific version (e.g., 1.2.3)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes",
    )

    args = parser.parse_args()

    print("=" * 50)
    print("AutoGLM-GUI Release Script")
    print("=" * 50)

    current_version = get_current_version()
    print(f"Current version: {current_version}")

    if args.major:
        bump_type = "major"
    elif args.minor:
        bump_type = "minor"
    else:
        bump_type = "patch"

    new_version = bump_version(current_version, bump_type, args.version)
    print(f"New version: {new_version}")
    print()

    if args.dry_run:
        print("[DRY RUN] No changes will be made")
        print()

    if not args.dry_run:
        if not update_pyproject_version(new_version):
            return 1
        print()

    ## run uv sync
    if not args.dry_run:
        if not run_uv_sync():
            return 1

    if not git_commit_version(new_version, dry_run=args.dry_run):
        return 1
    print()

    if not create_git_tag(new_version, dry_run=args.dry_run):
        return 1

    print()
    print("=" * 50)
    if args.dry_run:
        print("Dry run completed!")
    else:
        print("Release completed successfully!")
        print()
        print("Next steps:")
        print("  1. Push changes: git push && git push origin v" + new_version)
        print("  2. Build package: uv run python scripts/build.py --pack")
        print("  3. Publish to PyPI: uv publish")
    print("=" * 50)

    return 0


if __name__ == "__main__":
    sys.exit(main())
