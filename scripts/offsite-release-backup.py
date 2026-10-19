#!/usr/bin/env python3
"""Copy one verified release recovery bundle to an off-host filesystem.

The destination deduplicates large content (media files and the recovery
database) through a content-addressed hardlink store (``.objects``), so many
releases share one physical copy of each unchanged file. A bounded retention
policy keeps the most recent releases; after pruning, object-store entries that
no longer have any release hardlink are garbage-collected.

Remote copies use OpenSSH scp without a shell. Bundle verification and the
hardlink materialization happen on the local off-host filesystem.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

BUNDLE_NAME = re.compile(r"^release-[A-Za-z0-9_-]+$")
REVISION = re.compile(r"^[0-9a-f]{40}$")
DB_PATH = re.compile(r"^sqlite-[A-Za-z0-9_-]+/database\.sqlite$")
MEDIA_PATH = re.compile(r"^media-[A-Za-z0-9_-]+$")
REMOTE = re.compile(r"^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$")
OBJECTS_DIRNAME = ".objects"
DEFAULT_RETENTION = 8


def sha256(file: Path) -> str:
    digest = hashlib.sha256()
    before = file.lstat()
    if not stat.S_ISREG(before.st_mode) or file.is_symlink():
        raise ValueError(f"not a regular file: {file.name}")
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    after = file.lstat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise ValueError(f"file changed during verification: {file.name}")
    return digest.hexdigest()


def load_json(file: Path) -> dict:
    raw = file.read_text(encoding="utf-8")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError(f"JSON document is not an object: {file.name}")
    return value


def safe_child(root: Path, relative: str) -> Path:
    candidate_rel = PurePosixPath(relative)
    if candidate_rel.is_absolute() or ".." in candidate_rel.parts:
        raise ValueError("bundle path escapes its root")
    candidate = root.joinpath(*candidate_rel.parts)
    current = root
    for part in candidate_rel.parts:
        current = current / part
        if current.exists() and current.is_symlink():
            raise ValueError("bundle path must not contain symbolic links")
    resolved_parent = candidate.parent.resolve(strict=True)
    if resolved_parent != root and root not in resolved_parent.parents:
        raise ValueError("bundle path resolves outside its root")
    if candidate.is_symlink():
        raise ValueError("bundle path must not be a symbolic link")
    return candidate


def media_inventory(root: Path) -> list[dict]:
    entries: list[dict] = []

    def visit(current: Path, relative: str) -> None:
        info = current.lstat()
        if current.is_symlink():
            raise ValueError("media snapshot contains a symbolic link")
        if stat.S_ISDIR(info.st_mode):
            entries.append({"path": relative, "type": "directory"})
            for child in sorted(current.iterdir(), key=lambda item: item.name):
                child_relative = f"{relative}/{child.name}" if relative else child.name
                visit(child, child_relative)
        elif stat.S_ISREG(info.st_mode):
            entries.append(
                {
                    "path": relative,
                    "type": "file",
                    "sizeBytes": info.st_size,
                    "sha256": sha256(current),
                }
            )
        else:
            raise ValueError("media snapshot contains a special file")

    visit(root, "")
    return entries


def check_database(file: Path, expected: dict) -> None:
    info = file.lstat()
    if file.is_symlink() or not stat.S_ISREG(info.st_mode):
        raise ValueError("recovery database is not a regular file")
    if info.st_size != expected.get("sizeBytes") or sha256(file) != expected.get("sha256"):
        raise ValueError("recovery database checksum mismatch")
    uri = f"file:{file.as_posix()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchall()
        if integrity != [("ok",)]:
            raise ValueError("recovery database integrity check failed")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("recovery database foreign key check failed")
    finally:
        connection.close()


def verify_bundle(directory: Path) -> dict:
    if directory.is_symlink():
        raise ValueError("recovery bundle must not be a symbolic link")
    root = directory.resolve(strict=True)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("recovery bundle is not a regular directory")
    manifest_file = safe_child(root, "release.json")
    manifest = load_json(manifest_file)
    if manifest.get("version") != 1 or manifest.get("kind") != "release-recovery-bundle":
        raise ValueError("unsupported recovery bundle")
    if not REVISION.fullmatch(str(manifest.get("sourceRevision", ""))):
        raise ValueError("invalid source revision")
    database_meta = manifest.get("database")
    media_meta = manifest.get("media")
    if not isinstance(database_meta, dict) or not DB_PATH.fullmatch(str(database_meta.get("path", ""))):
        raise ValueError("invalid recovery database metadata")
    if not isinstance(media_meta, dict) or not MEDIA_PATH.fullmatch(str(media_meta.get("path", ""))):
        raise ValueError("invalid recovery media metadata")
    database = safe_child(root, database_meta["path"])
    check_database(database, database_meta)
    media_dir = safe_child(root, media_meta["path"])
    media_manifest_file = safe_child(media_dir, "manifest.json")
    if sha256(media_manifest_file) != media_meta.get("manifestSha256"):
        raise ValueError("recovery media manifest checksum mismatch")
    media_manifest = load_json(media_manifest_file)
    if (
        media_manifest.get("version") != 1
        or media_manifest.get("kind") != "media-snapshot"
        or not isinstance(media_manifest.get("entries"), list)
    ):
        raise ValueError("unsupported media snapshot")
    copied_media = safe_child(media_dir, "media")
    if media_inventory(copied_media) != media_manifest["entries"]:
        raise ValueError("recovery media inventory mismatch")
    file_count = sum(1 for entry in media_manifest["entries"] if entry.get("type") == "file")
    media_bytes = sum(int(entry.get("sizeBytes", 0)) for entry in media_manifest["entries"] if entry.get("type") == "file")
    return {
        "sourceRevision": manifest["sourceRevision"],
        "manifestSha256": sha256(manifest_file),
        "databaseSha256": database_meta["sha256"],
        "mediaManifestSha256": media_meta["manifestSha256"],
        "mediaFileCount": file_count,
        "mediaBytes": media_bytes,
    }


def copy_source(args: argparse.Namespace, staging_root: Path) -> Path:
    bundle_name = args.bundle_name
    if args.source_dir:
        source = Path(args.source_dir).expanduser().resolve(strict=True)
        if source.name != bundle_name:
            raise ValueError("source directory name does not match --bundle-name")
        target = staging_root / bundle_name
        shutil.copytree(source, target, symlinks=True)
        return target
    if not args.source or not args.source_path or not args.identity:
        raise ValueError("remote copy requires --source, --source-path and --identity")
    if not REMOTE.fullmatch(args.source):
        raise ValueError("invalid remote source")
    identity = Path(args.identity).expanduser().resolve(strict=True)
    source_path = args.source_path.rstrip("/\\")
    if any(character in source_path for character in "\r\n\0") or not (
        source_path.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", source_path)
    ):
        raise ValueError("remote source path must be absolute")
    if Path(source_path.replace("\\", "/")).name != bundle_name:
        raise ValueError("remote source path does not match --bundle-name")
    command = [
        "scp",
        "-q",
        "-r",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-i",
        str(identity),
        f"{args.source}:{source_path}",
        str(staging_root),
    ]
    subprocess.run(command, check=True)
    return staging_root / bundle_name


def _link_through_object(src: Path, dst: Path, object_store: Path, content_sha: str) -> None:
    """Deduplicate ``src`` via the content-addressed store, then hardlink to ``dst``.

    The source has already been checksum-verified by ``verify_bundle``, so the
    caller-supplied SHA is trusted to name the object.
    """
    object_file = object_store / content_sha
    if not object_file.exists():
        os.link(src, object_file)
        os.chmod(object_file, 0o600)
    dst.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    os.link(object_file, dst)


def materialize_dedup(staging: Path, target: Path, object_store: Path) -> dict:
    """Build the deduplicated release at ``target`` from the verified staging copy."""
    evidence = verify_bundle(staging)
    object_store.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(object_store, 0o700)
    if target.exists():
        raise ValueError("materialization target already exists")
    target.mkdir(mode=0o700, parents=True)

    manifest = load_json(staging / "release.json")
    database_meta = manifest["database"]
    media_meta = manifest["media"]
    db_rel = PurePosixPath(database_meta["path"])
    media_rel = PurePosixPath(media_meta["path"])

    # Top-level metadata files are copied per release (they are small).
    for item in staging.iterdir():
        if item.is_dir() or item.name == "offsite-receipt.json":
            continue
        shutil.copy2(item, target / item.name)

    # Database directory: database.sqlite is deduplicated; sidecar files copied.
    staging_db_dir = staging / db_rel.parent
    target_db_dir = target / db_rel.parent
    target_db_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    for item in staging_db_dir.iterdir():
        if item.name == db_rel.name:
            _link_through_object(item, target_db_dir / item.name, object_store, database_meta["sha256"])
        else:
            shutil.copy2(item, target_db_dir / item.name)

    # Media directory: manifest copied, media files deduplicated, dirs recreated.
    staging_media_dir = staging / media_rel
    target_media_dir = target / media_rel
    target_media_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copy2(staging_media_dir / "manifest.json", target_media_dir / "manifest.json")
    media_manifest = load_json(staging_media_dir / "manifest.json")
    staging_media_root = staging_media_dir / "media"
    target_media_root = target_media_dir / "media"
    target_media_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    for entry in media_manifest["entries"]:
        relative = entry["path"]
        dst = target_media_root / relative
        if entry["type"] == "directory":
            dst.mkdir(mode=0o700, parents=True, exist_ok=True)
        elif entry["type"] == "file":
            _link_through_object(staging_media_root / relative, dst, object_store, entry["sha256"])
        else:
            raise ValueError("unsupported media entry type")
    return evidence


def atomic_write_json(file: Path, value: dict) -> None:
    temporary = file.with_name(f".{file.name}.tmp-{os.getpid()}")
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    with temporary.open("x", encoding="utf-8") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    temporary.replace(file)


def _release_created(directory: Path) -> str:
    try:
        return str(load_json(directory / "release.json").get("createdAt", ""))
    except Exception:
        return ""


def rotate_releases(destination: Path, keep: int) -> list[str]:
    """Keep the ``keep`` most recent releases; prune the rest. Returns pruned names."""
    releases = [
        (created, directory)
        for directory in destination.glob("release-*")
        if (created := _release_created(directory))
    ]
    releases.sort(key=lambda item: item[0])
    pruned: list[str] = []
    if keep >= 0 and len(releases) > keep:
        for _, directory in releases[:-keep] if keep else releases:
            shutil.rmtree(directory)
            pruned.append(directory.name)
    return pruned


def garbage_collect_objects(object_store: Path) -> int:
    """Remove content objects with no release hardlink (link count of one)."""
    if not object_store.is_dir():
        return 0
    removed = 0
    for object_file in object_store.iterdir():
        try:
            info = object_file.stat()
        except FileNotFoundError:
            continue
        if info.st_nlink <= 1:
            object_file.unlink()
            removed += 1
    return removed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-name", required=True)
    parser.add_argument("--destination", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-dir")
    source.add_argument("--source")
    parser.add_argument("--source-path")
    parser.add_argument("--identity")
    parser.add_argument(
        "--retention",
        type=int,
        default=int(os.environ.get("SMART_CONTROL_OFFSITE_RETENTION", DEFAULT_RETENTION)),
    )
    args = parser.parse_args()
    if not BUNDLE_NAME.fullmatch(args.bundle_name):
        raise ValueError("invalid release bundle name")
    if args.retention < 0:
        raise ValueError("retention must be >= 0")
    destination = Path(args.destination).expanduser()
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = destination.resolve(strict=True)
    if destination.is_symlink() or not destination.is_dir():
        raise ValueError("offsite destination is not a safe directory")
    os.chmod(destination, 0o700)
    object_store = destination / OBJECTS_DIRNAME
    final = destination / args.bundle_name

    if final.exists():
        evidence = verify_bundle(final)
        receipt = load_json(final / "offsite-receipt.json")
        if receipt.get("bundleName") != args.bundle_name or receipt.get("manifestSha256") != evidence["manifestSha256"]:
            raise ValueError("existing offsite receipt does not match its bundle")
        pruned = rotate_releases(destination, args.retention)
        collected = garbage_collect_objects(object_store)
        print(
            f"OFFSITE_BUNDLE_CURRENT {args.bundle_name} {evidence['mediaFileCount']} "
            f"{evidence['mediaBytes']} pruned={len(pruned)} gc={collected}"
        )
        return 0

    staging_root = Path(tempfile.mkdtemp(prefix=".incoming-", dir=destination))
    os.chmod(staging_root, 0o700)
    finalizing = destination / f".finalizing-{os.getpid()}"
    try:
        copied = copy_source(args, staging_root)
        evidence = materialize_dedup(copied, finalizing, object_store)
        receipt = {
            "version": 1,
            "kind": "offsite-release-backup-receipt",
            "bundleName": args.bundle_name,
            "copiedAt": datetime.now(timezone.utc).isoformat(),
            "deduplicated": True,
            **evidence,
        }
        atomic_write_json(finalizing / "offsite-receipt.json", receipt)
        finalizing.replace(final)
        shutil.rmtree(staging_root)
        staging_root = None
        pruned = rotate_releases(destination, args.retention)
        collected = garbage_collect_objects(object_store)
        print(
            f"OFFSITE_BUNDLE_VERIFIED {args.bundle_name} {evidence['mediaFileCount']} "
            f"{evidence['mediaBytes']} pruned={len(pruned)} gc={collected}"
        )
        return 0
    except Exception:
        if finalizing.exists():
            shutil.rmtree(finalizing)
        if staging_root is not None and staging_root.exists():
            shutil.rmtree(staging_root)
        raise


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"OFFSITE_BUNDLE_FAILED: {error}", file=sys.stderr)
        raise SystemExit(1)
