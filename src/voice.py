#!/usr/bin/env python3
"""The voice of the film: the words of each scene in haiku-run.js, spoken by one ElevenLabs voice.

    python3 src/voice.py --find "Oliver Silk"        # the id of a voice: in the account, then in the voice library
    python3 src/voice.py --voice <voice id> [--name "Oliver Silk"]

It writes voice.m4a and voice.opus (AAC at 48 kbit/s, which every browser plays and which the page takes first, and Opus at 32 kbit/s: every scene in
order, a short pause between them) and haiku-voice.js (when each scene and each
sentence starts and ends, in seconds: the film runs on these times, and its captions are these sentences). The key is
read from ELEVEN_API_KEY, ELEVEN_LABS_API_KEY or ELEVENLABS_API_KEY. Needs ffmpeg and ffprobe. Run src/make.py first.
The clips are kept in src/.voice (not in git): a scene is bought again only when its words change.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.elevenlabs.io"
GAP = 0.55  # seconds of silence after each scene
# The files of the voice, the best first: (name, the type that a browser is asked about, the encoder). Both are made from the
# clips as they came (one lossy pass, not two).
OUT = [("voice.m4a", 'audio/mp4; codecs="mp4a.40.2"', ["-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart"]),
       ("voice.opus", 'audio/ogg; codecs="opus"', ["-c:a", "libopus", "-b:a", "32k"])]
LEAD = 0.4  # seconds of silence before the first


def key():
    for name in ("ELEVEN_API_KEY", "ELEVEN_LABS_API_KEY", "ELEVENLABS_API_KEY"):
        if os.environ.get(name):
            return os.environ[name]
    raise SystemExit("no ElevenLabs key in the environment")


def call(path, body=None):
    req = urllib.request.Request(API + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"xi-api-key": key(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit("ElevenLabs %s: %d %s" % (path.split("?")[0], e.code, e.read()[:300].decode("utf-8", "replace")))


def find(name):
    words = name.lower().split()
    for v in call("/v1/voices").get("voices", []):
        if all(w in v["name"].lower() for w in words):
            print("account  %s  %s  (%s)" % (v["voice_id"], v["name"], v.get("category")))
    got = call("/v1/shared-voices?" + urllib.parse.urlencode({"search": name, "page_size": 10}))
    for v in got.get("voices", []):
        print("library  %s  %s  owner %s  | %s %s %s | %s" % (v.get("voice_id"), v.get("name"), v.get("public_owner_id"), v.get("accent"),
              v.get("gender"), v.get("age"), (v.get("description") or "")[:100]))
    sub = call("/v1/user/subscription")
    print("plan: %s, %s of %s characters used, %s of %s voice slots" % (sub.get("tier"), sub.get("character_count"), sub.get("character_limit"),
          sub.get("voice_slots_used"), sub.get("voice_limit")))


def seconds(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def sentences(text, starts, ends):
    """[(start, end, sentence)] of a scene from the times of its characters."""
    out, at = [], 0
    for part in re.split(r"(?<=[.!?])\s+", text.strip()):
        i = text.index(part, at)
        j = i + len(part) - 1
        at = j + 1
        if i < len(starts) and j < len(ends):
            out.append((starts[i], ends[j], part))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--find")
    ap.add_argument("--voice")
    ap.add_argument("--name", default="")
    ap.add_argument("--model", default="eleven_multilingual_v2")
    args = ap.parse_args()
    if args.find:
        return find(args.find)
    if not args.voice:
        raise SystemExit("--voice <voice id> (see --find)")
    with open(os.path.join(HERE, "haiku-run.js"), encoding="utf-8") as f:
        run = json.loads(f.read().split("window.HAIKU_RUN = ", 1)[1].rstrip().rstrip(";"))
    texts = [s.get("speak") or s["say"] for s in run["scenes"]]  # what the voice reads
    shown = [s["say"] for s in run["scenes"]]                     # what the captions show: the same sentences
    cache = os.path.join(HERE, "src", ".voice")
    os.makedirs(cache, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        clips, scenes, cues, t = [], [], [], LEAD
        for n, text in enumerate(texts):
            body = {"text": text, "model_id": args.model, "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True}}
            if n:  # the scenes before and after: the voice keeps one tone across the clips
                body["previous_text"] = texts[n - 1]
            if n + 1 < len(texts):
                body["next_text"] = texts[n + 1]
            kept = os.path.join(cache, hashlib.sha256(json.dumps([args.voice, args.model, text]).encode()).hexdigest()[:20] + ".json")
            if os.path.exists(kept):
                with open(kept, encoding="utf-8") as f:
                    got = json.load(f)
            else:
                got = call("/v1/text-to-speech/%s/with-timestamps?output_format=mp3_44100_128" % args.voice, body)
                with open(kept, "w", encoding="utf-8") as f:
                    json.dump({"audio_base64": got["audio_base64"], "alignment": got.get("alignment")}, f)
            path = os.path.join(tmp, "%02d.mp3" % n)
            with open(path, "wb") as f:
                f.write(base64.b64decode(got["audio_base64"]))
            al = got.get("alignment") or {}
            dur = seconds(path)
            parts = sentences(text, al.get("character_start_times_seconds") or [], al.get("character_end_times_seconds") or [])
            if not parts:  # no times came back: the sentences share the clip by their length
                share, at = [len(p) for p in re.split(r"(?<=[.!?])\s+", text.strip())], 0.0
                for p, ln in zip(re.split(r"(?<=[.!?])\s+", text.strip()), share):
                    parts.append((at, at + dur * ln / sum(share), p))
                    at += dur * ln / sum(share)
            lines = re.split(r"(?<=[.!?])\s+", shown[n].strip())
            if len(lines) != len(parts):
                raise SystemExit("scene %d: say has %d sentences and speak has %d" % (n, len(lines), len(parts)))
            for (a, b, _), line in zip(parts, lines):
                cues.append([round(t + a, 2), round(t + b, 2), n, line])
            scenes.append([round(t, 2), round(t + dur + GAP, 2)])
            clips.append((path, dur))
            t += dur + GAP
            print("%2d  %5.1f s  %s" % (n, dur, text[:70]), file=sys.stderr)
        # one file: silence, then each clip and its pause
        cmd, graph = ["ffmpeg", "-v", "error", "-y"], []
        for path, _ in clips:
            cmd += ["-i", path]
        for n in range(len(clips)):
            graph.append("[%d:a]aresample=44100,aformat=channel_layouts=mono,%sapad=pad_dur=%s[a%d]" % (n, "adelay=%d," % int(LEAD * 1000) if n == 0 else "", GAP, n))
        graph.append("".join("[a%d]" % n for n in range(len(clips))) + "concat=n=%d:v=0:a=1,loudnorm=I=-17:TP=-1.5:LRA=11[out]" % len(clips))
        wav = os.path.join(tmp, "voice.wav")
        subprocess.run(cmd + ["-filter_complex", ";".join(graph), "-map", "[out]", "-ac", "1", "-ar", "48000", wav], check=True)
        total = seconds(wav)
        for name, _, enc in OUT:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav] + enc + [os.path.join(HERE, name)], check=True)
    data = {"src": OUT[0][0], "srcs": [[name, kind] for name, kind, _ in OUT], "voice": args.name, "total": round(total, 2), "scenes": scenes, "cues": cues}
    with open(os.path.join(HERE, "haiku-voice.js"), "w", encoding="utf-8") as f:
        f.write("// Made by src/voice.py: the files of the voice, and when each scene and each sentence starts and ends, in seconds.\nwindow.HAIKU_VOICE = " + json.dumps(data, separators=(",", ":")) + ";\n")
    print("%.1f s; %s; %d scenes, %d sentences" % (total, ", ".join("%s %d bytes" % (n, os.path.getsize(os.path.join(HERE, n))) for n, _, _ in OUT), len(scenes), len(cues)))


if __name__ == "__main__":
    main()
