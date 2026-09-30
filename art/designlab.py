"""Design Lab backend: drafts of furniture and character parts, generated, checked and published through the
same pipeline as everything else (studio.py for furniture, charkit.py for character parts).

The dev server (src/server/routes/devLab.ts, localhost only) runs these; each prints one line
`@@JSON {...}` with its result. Run from art/:

  uv run designlab.py furniture-generate <draft-dir> [--view se] [--note "..."] [--quality medium]
  uv run designlab.py furniture-check <draft-dir>
  uv run designlab.py furniture-publish <draft-dir> [--overwrite]
  uv run designlab.py part-generate <draft-dir> --view front|back [--quality high]
  uv run designlab.py part-publish <draft-dir>
  uv run designlab.py usage

A draft lives in art/drafts/<id>/: draft.json (the spec and the state of every view), refs/ (reference images),
takes/<n>/ (every generation, never overwritten), history.jsonl. Nothing reaches the catalog until it's
published: furniture goes through studio.py's JSON commands (lab-generate, check, lab-publish: the model spec,
the model check and the manifest lock), character parts through charkit.py.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import studio  # noqa: E402

DRAFTS = HERE / "drafts"
CHARKIT_OUT = HERE / "out" / "charkit"
# the drawings each rotation needs (studio.py lab-generate's VIEWS)
VIEWS = {"radial": [None], "flat": [None], "fixed": [None], "mirror": ["se", "nw"], "full": ["se", "sw", "ne", "nw"]}
# a catalog name is a label in the decorate palette (devLab.ts NAME_MAX)
NAME_MAX = 40


def views_of(f: dict) -> list:
    """The drawings a piece needs: one (radial, flat), a front and a back (mirror; just the front if it honestly
    looks the same from behind), or four (full). A long mirror piece is drawn sw + ne, lying along its width
    like every long piece in the catalog (the model draws a long piece turned se/nw along the wrong diagonal)."""
    if f["rotation"] == "mirror":
        long = f["footprint"][0] != f["footprint"][1]
        front, back = ("sw", "ne") if long else ("se", "nw")
        return [front] if f.get("sameFromBehind") else [front, back]
    return VIEWS[f["rotation"]]


def view_footprint(f: dict, facing: str | None) -> list:
    """The tiles a drawing covers (models.ts footprintFacing): [width, depth] facing sw/ne, [depth, width] facing
    se/nw."""
    w, d_ = f["footprint"]
    return [d_, w] if facing in ("se", "nw") else [w, d_]


# Chroma keys charkit extracts parts by (see parts_batch.py): hats and pets are drawn in teal, hair in brown.
PART_COLOUR = {
    "hair": "The hair is in a warm medium chestnut brown.",
    "hat": "In a solid medium teal colour (gold only for metal like a crown).",
    "top": "The garment is in a solid medium teal colour.",
    "pet": "Solid medium teal fur with lighter teal on the chest; small dark eyes.",
}


def out(obj: dict, code: int = 0):
    print("@@JSON " + json.dumps(obj))
    sys.exit(code)


def load(d: Path) -> dict:
    return json.loads((d / "draft.json").read_text(encoding="utf-8"))


def save(d: Path, draft: dict):
    draft["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    studio.write_atomic(d / "draft.json", json.dumps(draft, indent=2) + "\n")


def history(d: Path, event: str, **kw):
    with open(d / "history.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": event, **kw}) + "\n")


def draft_dir(p: str) -> Path:
    d = Path(p).resolve()
    if DRAFTS.resolve() not in d.parents or not (d / "draft.json").exists():
        out({"error": f"not a draft: {p}"}, 2)
    return d


def usage_rows() -> int:
    p = studio.OUT / "usage.jsonl"
    return len(p.read_text(encoding="utf-8").splitlines()) if p.exists() else 0


def spent_on(since: int, label) -> float:
    """What this draft's calls cost: usage rows logged since `since` whose label is this draft's (other tools may be
    drawing at the same time, so the total's difference would count their calls too)."""
    p = studio.OUT / "usage.jsonl"
    rows = [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines()[since:] if ln.strip()] if p.exists() else []
    return round(sum(studio.call_usd(r.get("usage")) for r in rows if label(str(r.get("label", "")))), 4)


def ref_pngs(d: Path, draft: dict) -> list[str]:
    """User reference images as PNGs, as paths relative to art/ (how studio sheets name their refs)."""
    rels = []
    conv = d / "refs_png"
    conv.mkdir(exist_ok=True)
    for name in draft.get("refs", []):
        src = d / "refs" / name
        if not src.exists():
            continue
        dst = conv / (Path(name).stem + ".png")
        if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
            im = Image.open(src).convert("RGBA")
            im.thumbnail((1024, 1024))
            im.save(dst)
        rels.append(str(dst.relative_to(HERE)).replace("\\", "/"))
    return rels


# ─────────────────────────────── furniture ───────────────────────────────
#
# Furniture goes through studio.py's JSON commands (lab-generate, check, lab-publish): the same guides, pixelizer,
# model check and manifest lock as every other model.

def studio_json(args: list, what: str) -> tuple[int, dict]:
    r = subprocess.run([sys.executable, "studio.py", *args], cwd=HERE, capture_output=True, text=True, encoding="utf-8")
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{")]
    if not lines:
        # the budget cap, an API error or a crash: studio says why on stderr
        out({"error": f"{what}: {(r.stderr or r.stdout).strip()[-800:] or 'no result'}"}, 1)
    return r.returncode, json.loads(lines[-1])


def model_decl(draft: dict) -> dict:
    """The draft's model spec declaration (src/shared/models.ts ModelSpec, without drawings)."""
    f = draft["furniture"]
    key = draft["key"]
    flat = f["rotation"] == "flat"
    cat = "wall-art" if flat else f["category"]
    name = (f.get("name") or "").strip()
    e: dict = {"name": name if 0 < len(name) <= NAME_MAX else studio.humanize(key), "category": cat,
               "tags": f.get("tags") or studio.model_tags(key, cat), "rooms": f.get("rooms") or ["lounge"],
               "footprint": list(f["footprint"]), "height": f["height"], "rotation": f["rotation"]}
    if f.get("themes"):
        e["themes"] = f["themes"]
    if flat:
        # THE WALL ART STANDARD (src/shared/models.ts wallFit): `v` is where it hangs, bottom to top; the drawing
        # decides its size (stage() sets the top and the span from it), centred in its span, never squeezed
        e.update(layer="wall", walk="open", wall={"v": list(f.get("wallV") or [18, 47])})
    else:
        seating = cat == "seating"
        e["layer"] = "floor" if cat == "rug" else f.get("layer") or "object"
        e["walk"] = "seat" if seating else "open" if e["layer"] == "floor" else "blocked"
        if seating:
            e.update(seat=f.get("seat") or 12, sitStyle=f.get("sitStyle") or "chair", backrest=bool(f.get("backrest", True)))
            if f.get("arms"):
                e["arms"] = True
        if f.get("surface") is not None:
            e["surface"] = f["surface"]
        if f["rotation"] == "mirror" and f.get("sameFromBehind"):
            e["sameFromBehind"] = True
    kinds = [a["kind"] for a in f.get("actions") or [] if a.get("kind")]
    if cat == "seating":
        kinds.insert(0, "sit")
    if f.get("light"):
        kinds.append("toggle")
    kinds = list(dict.fromkeys(kinds))
    if kinds:
        e["use"] = {"face": f.get("useFace") or "front", "actions": kinds}
    return e


def draw_spec(draft: dict, footprint: list, note: str | None, view: str | None) -> dict:
    """lab-generate's model.json: the declaration plus how to draw it."""
    f = draft["furniture"]
    spec = {**model_decl(draft), "key": draft["key"], "footprint": footprint, "prompt": f["prompt"].strip(),
            "prompts": dict(f.get("prompts") or {}), "fit": f.get("fit", "stand"), "fill": f.get("fill", 0.7),
            "colors": f.get("colors", 28), "quality": f.get("quality", "medium")}
    if f.get("width"):
        spec["width"] = f["width"]
    if note:
        k = view or "se"
        spec["prompts"][k] = (spec["prompts"].get(k, "") + " " + note.strip()).strip()
    return spec


def cmd_furniture_generate(a):
    d = draft_dir(a.draft)
    draft = load(d)
    f = draft["furniture"]
    views = views_of(f)
    if a.view:
        if a.view not in [v or "one" for v in views]:
            out({"error": f"{a.view} isn't a view of a '{f['rotation']}' piece"}, 2)
        views = [None if a.view == "one" else a.view]
    n = len(draft.get("takes", [])) + 1
    take = d / "takes" / str(n)
    take.mkdir(parents=True, exist_ok=True)
    refs = [str(HERE / r) for r in ref_pngs(d, draft)]
    # redrawing one view: the accepted views go along as references, so it stays the same piece
    if a.view:
        for fc, v in (draft.get("views") or {}).items():
            if v.get("accepted") and fc != a.view and v.get("file"):
                refs.insert(0, str(d / v["file"]))
    # studio.py lab-generate draws a spec's views on one sheet, each on the tiles it covers facing that way
    # (models.ts footprintFacing), from the spec's true footprint. Its 'mirror' views are se + nw; a long mirror
    # piece here is drawn sw + ne (lying along its width, like the catalog's long pieces), so that sheet is drawn
    # as 'full' and only the views the piece needs are kept.
    need = [fc or "one" for fc in views]
    exact = views == VIEWS[f["rotation"]]
    view = a.view or (None if exact or len(views) > 1 else views[0])
    spec = draw_spec(draft, list(f["footprint"]), a.note, view if view != "one" else None)
    if not exact and not (a.view and a.view in [v or "one" for v in VIEWS[f["rotation"]]]):
        spec["rotation"] = "full"
    since = usage_rows()
    measured: dict = {}
    run = take / "run1"
    run.mkdir(parents=True, exist_ok=True)
    (run / "model.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
    args = ["lab-generate", "--spec", str(run / "model.json"), "--out", str(run),
            "--quality", a.quality or f.get("quality", "medium")]
    if view:
        args += ["--view", view]
    for r in refs:
        args += ["--ref", r]
    _code, res = studio_json(args, "drawing it")
    if res.get("error"):
        out({"error": res["error"]}, 1)
    results = {k: v for k, v in (res.get("views") or {}).items() if k in need}
    ent = res.get("entry") or {}
    if "height" in ent:
        measured["height"] = ent["height"]
    if "base" in ent:
        measured["base"] = ent["base"]
    if not results:
        out({"error": "the model returned no usable drawing; try again with a clearer prompt"}, 1)
    usd = spent_on(since, lambda lb: lb.startswith(f"lab/{draft['key'].replace('/', '__')}/"))
    draft.setdefault("views", {})
    if not a.view:
        # a whole new drawing: views the piece no longer needs (it turned differently before) go
        need = [v or "one" for v in views_of(f)]
        draft["views"] = {k: v for k, v in draft["views"].items() if k in need}
    for name, v in results.items():
        rel = Path(v["file"]).resolve().relative_to(d)
        draft["views"][name] = {"file": rel.as_posix(), "anchor": [int(v["anchor"][0]), int(v["anchor"][1])],
                                "nudge": [0, 0], "take": n, "accepted": False}
    draft["measured"] = {**draft.get("measured", {}), **measured}
    names = sorted(results)
    draft.setdefault("takes", []).append({"n": n, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "views": names,
                                          "note": a.note or "", "usd": round(usd, 4)})
    save(d, draft)
    history(d, "generate", take=n, views=names, usd=round(usd, 4), note=a.note or "")
    out({"draft": draft, "usd": round(usd, 4)})


def light_point(img: Image.Image, r: int) -> dict:
    """A lamp's light: the middle of its shade (a third of the way down its silhouette)."""
    box = img.getbbox() or (0, 0, img.width, img.height)
    return {"x": round((box[0] + box[2]) / 2), "y": round(box[1] + (box[3] - box[1]) * 0.3), "r": r}


def stage(d: Path, draft: dict) -> tuple[dict, Path]:
    """The manifest entry this draft would publish (a ModelSpec) with its drawings in <draft>/stage/sprites, each
    view's anchor moved by its nudge; <draft>/stage/entries.json holds {key: entry}."""
    f = draft["furniture"]
    key = draft["key"]
    sprites = d / "stage" / "sprites"
    if sprites.exists():
        shutil.rmtree(sprites)
    sprites.mkdir(parents=True)
    e = model_decl(draft)
    m = draft.get("measured") or {}
    if f["rotation"] != "flat":
        e["height"] = m.get("height", e["height"])
        e["base"] = m.get("base", "centred")
    e["fit"] = "anchor"
    light_r = (f.get("light") or {}).get("r", 40) if f.get("light") else None
    need = [v or "one" for v in views_of(f)]
    for name, v in sorted((draft.get("views") or {}).items()):
        if name not in need:
            continue
        img = Image.open(d / v["file"]).convert("RGBA")
        fname = f"{key}{'' if name == 'one' else '.' + name}.png"
        (sprites / fname).parent.mkdir(parents=True, exist_ok=True)
        img.save(sprites / fname)
        rec: dict = {"file": fname}
        if f["rotation"] != "flat":
            rec["anchor"] = [v["anchor"][0] + v["nudge"][0], v["anchor"][1] + v["nudge"][1]]
        if light_r:
            rec["light"] = light_point(img, light_r)
        if name == "one":
            e.update(rec)
            if f["rotation"] == "flat":
                wall_standard(e, img)
        else:
            e.setdefault("facings", {})[name] = rec
    studio.write_atomic(d / "stage" / "entries.json", json.dumps({key: e}, indent=2))
    return e, sprites


def wall_standard(e: dict, img: Image.Image):
    """THE WALL ART STANDARD (src/shared/models.ts wallFit) on a wall piece's entry, from its drawing: drawn at
    exactly 2:1 (32 px per tile along the wall, 2 per wall unit up it), it hangs from the bottom of `wall.v` and is
    as tall as its drawing (top = bottom + h/2), centred in a span wide enough to hold it: a drawing wider than its
    span grows the span, it's never squeezed."""
    v0 = e["wall"]["v"][0]
    h = img.height // 2 if img.height % 2 == 0 else img.height / 2
    e["wall"] = {**{k: v for k, v in e["wall"].items() if k != "margin"}, "v": [v0, v0 + h]}
    e["footprint"] = [max(int(e["footprint"][0]), -(-img.width // 32)), 1]
    e["height"] = h


def model_check(d: Path, draft: dict, e: dict, write: bool = False) -> list[str]:
    """THE SEAT CHECK (scripts/lab-model.ts: seatLayers.ts seatProblems, the gate's): the seat's model holding in every
    facing on the staged drawings, and passed by the reviewer; with `write`, stored in art/seat-models.json (after the
    piece is published). A seat is published with its model: that's how people are drawn sitting in it."""
    if e.get("walk") != "seat":
        return []
    model = draft["furniture"].get("seatModel")
    if not model or not model.get("model"):
        return ["give the seat its model: Auto-fit in How people sit in it, tune it and pass it"]
    (d / "stage" / "model.json").write_text(json.dumps(model), encoding="utf-8")
    # (--no-maglev: Node 24.12's Maglev JIT crashes node on this machine)
    args = ["node", "--no-maglev", *studio.TSX, "scripts/lab-model.ts", "--entries", str(d / "stage" / "entries.json"),
            "--sprites", str(d / "stage" / "sprites"), "--key", draft["key"], "--model", str(d / "stage" / "model.json")]
    if write:
        args.append("--write")
    r = subprocess.run(args, cwd=HERE.parent, capture_output=True, text=True, encoding="utf-8")
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{")]
    res = json.loads(lines[-1]) if lines else {"error": (r.stderr or "model check failed").strip()[-400:]}
    if res.get("error"):
        return [f"seat model: {res['error']}"]
    return [f"seat model, {p_}" for p_ in res.get("problems", [])]


def has_model(draft: dict) -> bool:
    return bool((draft["furniture"].get("seatModel") or {}).get("model"))


def seat_checks(d: Path, draft: dict, e: dict) -> list[str]:
    """What a seat must pass to publish: its model, holding in every facing and passed by the reviewer."""
    return model_check(d, draft, e)


def cmd_furniture_check(a):
    d = draft_dir(a.draft)
    draft = load(d)
    f = draft["furniture"]
    need = [v or "one" for v in views_of(f)]
    missing = [v for v in need if v not in (draft.get("views") or {})]
    e, sprites = stage(d, draft)
    problems = [f"draw the {', '.join(missing)} view(s)"] if missing else []
    if not missing:
        problems += seat_checks(d, draft, e)
    _code, res = studio_json(["check", "--entries", str(d / "stage" / "entries.json"), "--sprites", str(sprites)], "the model check")
    problems += (res.get("problems") or {}).get(draft["key"], [])
    out({"problems": problems, "entry": e, "sprites": sprites.relative_to(HERE.parent).as_posix()})


def cmd_furniture_publish(a):
    d = draft_dir(a.draft)
    draft = load(d)
    key = draft["key"]
    views = draft.get("views") or {}
    not_ok = [k for k, v in views.items() if not v.get("accepted")]
    if not views or not_ok:
        out({"error": f"accept every view before publishing (not yet: {', '.join(not_ok) or 'all'})"}, 2)
    e, sprites = stage(d, draft)
    seat = seat_checks(d, draft, e)
    if seat:
        out({"error": "the seat isn't ready: its model doesn't hold yet", "problems": seat}, 1)
    # a key already in the catalog is only replaced by its own draft: opened from the library, or published from here
    args = ["lab-publish", "--entries", str(d / "stage" / "entries.json"), "--sprites", str(sprites)]
    if draft.get("origin") == key or draft.get("published"):
        args.append("--overwrite")
    _code, res = studio_json(args, "publishing")
    if not res.get("ok"):
        problems = [p_ for ps in (res.get("problems") or {}).values() for p_ in ps]
        out({"error": res.get("error") or "the model check refuses it", "problems": problems}, 1)
    if has_model(draft):
        model = model_check(d, draft, e, write=True)
        if model:
            out({"error": "published, but its model couldn't be stored in art/seat-models.json", "problems": model}, 1)
    draft["published"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    save(d, draft)
    history(d, "publish", key=key)
    out({"published": key, "entry": e})


# ─────────────────────────────── character parts ───────────────────────────────

def part_name(draft: dict) -> str:
    return "lab-" + draft["id"]


def cmd_part_generate(a):
    d = draft_dir(a.draft)
    draft = load(d)
    p = draft["part"]
    kind, name = p["kind"], part_name(draft)
    views = ["front"] if kind == "pet" else ["front", "back"]
    if a.view not in views:
        out({"error": f"a {kind} has views {views}"}, 2)
    prompt = p["prompt"].strip()
    if a.view == "back" and p.get("backPrompt"):
        prompt = p["backPrompt"].strip()
    elif a.view == "back":
        prompt = "Seen from BEHIND: " + prompt
    prompt += " " + PART_COLOUR[kind]
    cmd = [sys.executable, "charkit.py", kind, name, "--view", a.view, "--prompt", prompt, "--no-publish", "--regen",
           "--quality", a.quality or p.get("quality", "high")]
    if p.get("long"):
        cmd.append("--long")
    if p.get("drape") and kind != "hair":
        cmd.append("--drape")
    for r in ref_pngs(d, draft):
        cmd += ["--ref", r]
    since = usage_rows()
    r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
    if r.returncode != 0:
        out({"error": (r.stderr or r.stdout).strip()[-600:]}, 1)
    job = f"{kind}-{name}-{a.view}"
    placed = json.loads((CHARKIT_OUT / f"{job}.json").read_text(encoding="utf-8"))
    n = len(draft.get("takes", [])) + 1
    take = d / "takes" / str(n)
    take.mkdir(parents=True, exist_ok=True)
    for ext in ("raw.png", "map.png", "snapped.png", "prompt.txt", "json"):
        src = CHARKIT_OUT / f"{job}.{ext}"
        if src.exists():
            shutil.copy2(src, take / f"{a.view}.{ext}")
    usd = spent_on(since, lambda lb: lb == job)
    draft.setdefault("views", {})[a.view] = {"placed": {k: placed[k] for k in ("x", "y", "rows") if k in placed},
                                            "behind": placed.get("behind"), "take": n, "accepted": False}
    draft.setdefault("takes", []).append({"n": n, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "views": [a.view], "usd": usd})
    save(d, draft)
    history(d, "generate", take=n, views=[a.view], usd=usd)
    out({"draft": draft, "usd": usd})


def cmd_part_publish(a):
    d = draft_dir(a.draft)
    draft = load(d)
    p = draft["part"]
    kind, src_name, final = p["kind"], part_name(draft), p["name"]
    views = draft.get("views") or {}
    not_ok = [k for k, v in views.items() if not v.get("accepted")]
    if not views or not_ok:
        out({"error": f"generate and accept every view first (not yet: {', '.join(not_ok) or 'all'})"}, 2)
    lib = HERE.parent / "src" / "client" / "engine" / "sprites" / f"{kind}Lib.json"
    existing = json.loads(lib.read_text(encoding="utf-8")) if lib.exists() else {}
    if final in existing and final not in (draft.get("origin"), draft.get("publishedAs")):
        out({"error": f"a {kind} called '{final}' already exists; pick another name"}, 2)
    jobs = []
    for view in views:
        s_job, f_job = f"{kind}-{src_name}-{view}", f"{kind}-{final}-{view}"
        shutil.copy2(CHARKIT_OUT / f"{s_job}.raw.png", CHARKIT_OUT / f"{f_job}.raw.png")
        meta = json.loads((CHARKIT_OUT / f"{s_job}.meta.json").read_text(encoding="utf-8"))
        meta["name"] = final
        (CHARKIT_OUT / f"{f_job}.meta.json").write_text(json.dumps(meta), encoding="utf-8")
        jobs.append(f_job)
    r = subprocess.run([sys.executable, "charkit.py", "extract", *jobs], cwd=HERE, capture_output=True, text=True)
    if r.returncode != 0:
        out({"error": (r.stderr or r.stdout).strip()[-600:]}, 1)
    label = p.get("label") or final.replace("-", " ").capitalize()
    slot = {"hair": "hair", "hat": "headwear", "top": "top", "pet": "pet"}[kind]
    # kept on the draft: writing the library reloads the dev page, so the lab shows the line from here
    draft["catalogLine"] = f"I('{slot}', '{final}', '{label}'),"
    draft["publishedAs"] = final
    draft["published"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    save(d, draft)
    history(d, "publish", kind=kind, name=final)
    out({"published": f"{kind}.{final}", "catalogLine": draft["catalogLine"]})


# ─────────────────────────────── spend ───────────────────────────────

def cmd_usage(_a):
    p = studio.OUT / "usage.jsonl"
    rows = [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()] if p.exists() else []
    today = dt.date.today().isoformat()
    def usd(r):
        return studio.call_usd(r.get("usage"))
    by = {}
    for r in rows[-400:]:
        k = f"{r.get('kind')}|{r.get('quality')}|{r.get('size')}"
        by.setdefault(k, []).append(usd(r))
    est = {k: round(sum(v) / len(v), 4) for k, v in by.items() if v}
    out({"total": round(studio.spent(), 2), "cap": studio.cap(), "today": round(sum(usd(r) for r in rows if str(r.get("t", "")).startswith(today)), 2),
         "callsToday": sum(1 for r in rows if str(r.get("t", "")).startswith(today)), "estimates": est})


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("furniture-generate")
    g.add_argument("draft")
    g.add_argument("--view")
    g.add_argument("--note")
    g.add_argument("--quality")
    g.set_defaults(fn=cmd_furniture_generate)
    c = sub.add_parser("furniture-check")
    c.add_argument("draft")
    c.set_defaults(fn=cmd_furniture_check)
    p = sub.add_parser("furniture-publish")
    p.add_argument("draft")
    p.add_argument("--overwrite", action="store_true")
    p.set_defaults(fn=cmd_furniture_publish)
    pg = sub.add_parser("part-generate")
    pg.add_argument("draft")
    pg.add_argument("--view", required=True)
    pg.add_argument("--quality")
    pg.set_defaults(fn=cmd_part_generate)
    pp = sub.add_parser("part-publish")
    pp.add_argument("draft")
    pp.add_argument("--overwrite", action="store_true")
    pp.set_defaults(fn=cmd_part_publish)
    u = sub.add_parser("usage")
    u.set_defaults(fn=cmd_usage)
    a = ap.parse_args()
    try:
        a.fn(a)
    except SystemExit as e:
        # studio's own refusals (the budget cap, API errors) exit with a message: report it as a result
        if isinstance(e.code, str):
            out({"error": e.code}, 1)
        raise
    except Exception as e:  # noqa: BLE001
        out({"error": f"{type(e).__name__}: {e}"}, 1)


if __name__ == "__main__":
    main()
