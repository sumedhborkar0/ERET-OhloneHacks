from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

_MIME_BY_SUFFIX = {
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
}


@dataclass
class EvalCase:
    case_id: str
    clip_path: Path
    expected_text: str
    required_terms: list[str]
    forbidden_terms: list[str]
    landmarks_path: Path | None
    notes: str


def _normalize_text(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _token_f1(prediction: str, expected: str) -> float:
    pred_tokens = _normalize_text(prediction).split()
    exp_tokens = _normalize_text(expected).split()
    if not pred_tokens and not exp_tokens:
        return 1.0
    if not pred_tokens or not exp_tokens:
        return 0.0

    pred_counts: dict[str, int] = {}
    exp_counts: dict[str, int] = {}
    for token in pred_tokens:
        pred_counts[token] = pred_counts.get(token, 0) + 1
    for token in exp_tokens:
        exp_counts[token] = exp_counts.get(token, 0) + 1

    overlap = 0
    for token, count in pred_counts.items():
        overlap += min(count, exp_counts.get(token, 0))

    precision = overlap / len(pred_tokens)
    recall = overlap / len(exp_tokens)
    if precision + recall == 0:
        return 0.0
    return (2 * precision * recall) / (precision + recall)


def _parse_terms(raw: str) -> list[str]:
    return [part.strip().lower() for part in (raw or "").split("|") if part.strip()]


def _load_landmarks(path: Path | None) -> list[dict[str, Any]] | None:
    if path is None:
        return None
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise ValueError(f"Landmarks file must contain a JSON list: {path}")
    return payload


def _infer_mime_type(clip_path: Path) -> str:
    return _MIME_BY_SUFFIX.get(clip_path.suffix.lower(), "video/webm")


def _load_cases(manifest_path: Path) -> list[EvalCase]:
    with manifest_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required_columns = {"case_id", "clip_path", "expected_text"}
        missing = required_columns.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Manifest is missing required columns: {sorted(missing)}")

        cases: list[EvalCase] = []
        for row in reader:
            case_id = (row.get("case_id") or "").strip()
            clip_path = Path((row.get("clip_path") or "").strip())
            expected_text = (row.get("expected_text") or "").strip()
            required_terms = _parse_terms(row.get("required_terms") or "")
            forbidden_terms = _parse_terms(row.get("forbidden_terms") or "")
            landmarks_raw = (row.get("landmarks_path") or "").strip()
            notes = (row.get("notes") or "").strip()

            if not case_id or not str(clip_path) or not expected_text:
                raise ValueError(f"Invalid row in manifest: {row}")

            cases.append(
                EvalCase(
                    case_id=case_id,
                    clip_path=clip_path,
                    expected_text=expected_text,
                    required_terms=required_terms,
                    forbidden_terms=forbidden_terms,
                    landmarks_path=Path(landmarks_raw) if landmarks_raw else None,
                    notes=notes,
                )
            )
    return cases


def _score_case(case: EvalCase, prediction: str) -> dict[str, Any]:
    norm_prediction = _normalize_text(prediction)
    norm_expected = _normalize_text(case.expected_text)

    exact_match = norm_prediction == norm_expected
    f1 = _token_f1(prediction, case.expected_text)
    required_ok = all(term in norm_prediction for term in case.required_terms)
    forbidden_ok = all(term not in norm_prediction for term in case.forbidden_terms)
    pass_case = exact_match or (f1 >= 0.72 and required_ok and forbidden_ok)

    return {
        "exact_match": exact_match,
        "token_f1": round(f1, 4),
        "required_ok": required_ok,
        "forbidden_ok": forbidden_ok,
        "pass": pass_case,
    }


def run_eval(manifest_path: Path, output_dir: Path) -> Path:
    from backend.gemini_client import translate_video

    cases = _load_cases(manifest_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now()
    run_id = started_at.strftime("%Y%m%d_%H%M%S")
    output_path = output_dir / f"eval_results_{run_id}.csv"

    rows: list[dict[str, Any]] = []
    for case in cases:
        clip_path = (manifest_path.parent / case.clip_path).resolve()
        if not clip_path.exists():
            raise FileNotFoundError(f"Clip not found for case {case.case_id}: {clip_path}")

        landmarks = None
        if case.landmarks_path is not None:
            landmarks_path = (manifest_path.parent / case.landmarks_path).resolve()
            landmarks = _load_landmarks(landmarks_path)

        with clip_path.open("rb") as handle:
            video_bytes = handle.read()

        prediction = translate_video(
            video_bytes=video_bytes,
            mime_type=_infer_mime_type(clip_path),
            landmarks=landmarks,
        )
        scores = _score_case(case, prediction)

        rows.append(
            {
                "case_id": case.case_id,
                "clip_path": str(case.clip_path),
                "expected_text": case.expected_text,
                "prediction": prediction,
                "exact_match": scores["exact_match"],
                "token_f1": scores["token_f1"],
                "required_ok": scores["required_ok"],
                "forbidden_ok": scores["forbidden_ok"],
                "pass": scores["pass"],
                "notes": case.notes,
            }
        )

    fieldnames = list(rows[0].keys()) if rows else []
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    total = len(rows)
    pass_count = sum(1 for row in rows if row["pass"])
    exact_count = sum(1 for row in rows if row["exact_match"])
    mean_f1 = (sum(float(row["token_f1"]) for row in rows) / total) if total else 0.0
    ended_at = datetime.now()
    duration_seconds = (ended_at - started_at).total_seconds()

    print(f"Completed {total} cases in {duration_seconds:.1f}s")
    print(f"Pass rate: {pass_count}/{total} ({(pass_count / total * 100) if total else 0:.1f}%)")
    print(f"Exact match: {exact_count}/{total} ({(exact_count / total * 100) if total else 0:.1f}%)")
    print(f"Mean token F1: {mean_f1:.3f}")
    print(f"Saved: {output_path}")
    return output_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Batch-evaluate pre-recorded ASL clips through translate_video().",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("eval/manifest.csv"),
        help="CSV manifest containing evaluation cases.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("eval/results"),
        help="Directory for timestamped result CSV files.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    run_eval(manifest_path=args.manifest, output_dir=args.output_dir)


if __name__ == "__main__":
    main()
