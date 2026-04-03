from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ClipCase:
    index: int
    filename: str
    expected_label: str
    prediction: str
    passed: bool


def _extract_clip_number(filename: str) -> int | None:
    match = re.search(r"(\d+)", filename)
    if not match:
        return None
    return int(match.group(1))


def _infer_mime_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".mov":
        return "video/quicktime"
    if suffix == ".mp4":
        return "video/mp4"
    if suffix == ".webm":
        return "video/webm"
    return "video/webm"


def _matches_label(prediction: str, expected_label: str) -> bool:
    text = " ".join(prediction.lower().split())
    if expected_label == "stop":
        return "stop" in text
    if expected_label == "help":
        return "help" in text
    return False


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Send clips to Gemini using translate_video(), starting from a clip number. "
            "First N clips are expected to mean 'stop'; the rest are expected to mean 'help'."
        )
    )
    parser.add_argument(
        "--clips-dir",
        type=Path,
        default=Path("eval/clips"),
        help="Directory containing video clips.",
    )
    parser.add_argument(
        "--start-number",
        type=int,
        default=2029,
        help="Only clips with numeric id >= this value are included.",
    )
    parser.add_argument(
        "--first-stop-count",
        type=int,
        default=5,
        help="How many first clips (after sorting) are expected to be 'stop'.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    try:
        from backend.gemini_client import translate_video
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Missing dependencies for Gemini client. Activate your project venv and install requirements."
        ) from exc

    clips_dir: Path = args.clips_dir
    start_number: int = args.start_number
    first_stop_count: int = args.first_stop_count

    if not clips_dir.exists():
        raise SystemExit(f"Clips directory not found: {clips_dir}")

    clip_files: list[tuple[int, Path]] = []
    for path in clips_dir.iterdir():
        if not path.is_file():
            continue
        clip_number = _extract_clip_number(path.name)
        if clip_number is None or clip_number < start_number:
            continue
        clip_files.append((clip_number, path))

    clip_files.sort(key=lambda item: item[0])
    if not clip_files:
        raise SystemExit(f"No clips found in {clips_dir} with number >= {start_number}")

    print(f"Testing {len(clip_files)} clips from {clips_dir} starting at {start_number}")
    print(f"First {first_stop_count} expected label: stop")
    print("Remaining expected label: help")
    print("-" * 70)

    cases: list[ClipCase] = []
    for idx, (_, path) in enumerate(clip_files):
        expected_label = "stop" if idx < first_stop_count else "help"
        with path.open("rb") as handle:
            video_bytes = handle.read()

        prediction = translate_video(
            video_bytes=video_bytes,
            mime_type=_infer_mime_type(path),
            landmarks=None,
        )
        passed = _matches_label(prediction, expected_label)
        cases.append(
            ClipCase(
                index=idx + 1,
                filename=path.name,
                expected_label=expected_label,
                prediction=prediction,
                passed=passed,
            )
        )
        status = "PASS" if passed else "FAIL"
        print(
            f"[{status}] #{idx + 1:02d} {path.name} | expected={expected_label} | prediction={prediction}"
        )

    total = len(cases)
    passed_total = sum(1 for case in cases if case.passed)
    accuracy = (passed_total / total * 100.0) if total else 0.0

    print("-" * 70)
    print(f"Summary: {passed_total}/{total} passed ({accuracy:.1f}%)")
    print("Rule used: expected 'stop' means prediction contains 'stop'; expected 'help' contains 'help'.")


if __name__ == "__main__":
    main()
