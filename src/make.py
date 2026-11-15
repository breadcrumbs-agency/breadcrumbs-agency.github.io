#!/usr/bin/env python3
"""The numbers of the example on the landing page: one chat on Claude Haiku 5.5, from the two logs that breadcrumbs keeps.

    python3 src/make.py --home <the breadcrumbs folder of a Hermes profile> --session <session id, or its first characters>

It reads <home>/usage.log(.1) (one line for each request to the provider, with the provider's token counts) and
<home>/ace.log(.1) (one line for each decision of the context engine). It writes haiku-run.js (the data and the scenes of the film; src/voice.py speaks the scenes) and puts
the totals into index.html (every element that has a data-k). Numbers only leave the logs: token counts, seconds, dollars.
No text of the chat, no path, no id other than the session id that is asked for.
"""
import argparse
import bisect
import json
import os
import re
import statistics
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KV = re.compile(r"(\w+)=(\S+)")
STEP = 100_000  # tokens: a prompt over this pays the high tier for all of its tokens
# USD per 1M tokens (Anthropic pricing, read 2026-11-14; the table on the page): input, cache read, cache write, output
LOW = (0.10, 0.01, 0.125, 0.50)
HIGH = (0.50, 0.05, 0.625, 2.50)


def lines(home, names):
    for name in names:
        try:
            with open(os.path.join(home, name), encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            continue
        for line in text.split("\n")[:-1]:
            try:
                ts = time.mktime(time.strptime(line[:19], "%Y-%m-%dT%H:%M:%S"))
            except ValueError:
                continue
            yield ts, dict(KV.findall(line[19:]))


def usd(r, uncached=False):
    """The dollars of one request: (all of it, the input side alone). uncached: the same tokens with no cache."""
    rin, rcr, rcw, rout = HIGH if r["prompt"] > STEP else LOW
    inp = r["prompt"] * rin if uncached else r["in"] * rin + r["cr"] * rcr + r["cw"] * rcw
    return (inp + r["out"] * rout) / 1e6


def second_agent(kv):
    """True for a request that another agent sent under the chat's session id: Hermes names a turn <session>:<task>:<n>,
    and the task of the chat itself is its session id."""
    p = kv.get("turn", "").split(":")
    return len(p) == 3 and p[0] == kv.get("sess") and p[1] != p[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--home", required=True)
    ap.add_argument("--session", required=True)
    args = ap.parse_args()

    req = []
    for ts, kv in lines(args.home, ("usage.log.1", "usage.log")):
        if not kv.get("sess", "").startswith(args.session) or kv.get("task") != "main" or "haiku" not in kv.get("model", ""):
            continue
        r = {k: int(kv[k]) for k in ("in", "cr", "cw", "out")}
        r.update(prompt=r["in"] + r["cr"] + r["cw"], dur=float(kv["dur"]), n=int(kv["n"]), side=second_agent(kv), turn=kv["turn"])
        r["t0"] = ts - r["dur"]  # the stamp of a line is the end of its request
        req.append(r)
    req.sort(key=lambda r: r["t0"])
    ace = [(ts, kv) for ts, kv in lines(args.home, ("ace.log.1", "ace.log")) if kv.get("sess") and args.session.startswith(kv["sess"])]
    if not req or not ace:
        raise SystemExit("no request of that session in the logs")
    start = min(req[0]["t0"], ace[0][0])
    begins = [r["t0"] for r in req]
    chat, agent = [r for r in req if not r["side"]], [r for r in req if r["side"]]
    base = min(r["cr"] for r in req if r["cr"])  # the fixed prefix (system prompt and tools): the least that a request read

    def total(rs):
        tok = sum(r["prompt"] for r in rs)
        return {"n": len(rs), "max": max(r["prompt"] for r in rs), "over": sum(r["prompt"] > STEP for r in rs),
                "hit": sum(r["cr"] for r in rs) / tok, "paid": sum(usd(r) for r in rs), "unc": sum(usd(r, True) for r in rs)}

    T = {"chat": total(chat), "agent": total(agent), "all": total(req)}
    over = [r for r in req if r["prompt"] > STEP]
    rewrites = [r for r in chat if r["cr"] == base]  # a fold: the request reads the prefix and writes the rest again
    folds = [ts for ts, kv in ace if kv.get("act") == "fold"]
    raw = [int(kv["in"]) for _, kv in ace]
    first_runs = [r for r in agent if r["n"] == 1]
    after = [r for r in first_runs if over and r["t0"] > over[-1]["t0"]]
    med = lambda rs: statistics.median(r["dur"] for r in rs)
    n0 = lambda x: format(int(round(x)), ",")
    money = lambda x: "$%.2f" % x if x >= 1 else "$%.3f" % x if x >= 0.05 else "$%.4f" % x
    pc = lambda x: "%.1f%%" % (100 * x)
    span = req[-1]["t0"] + req[-1]["dur"] - start
    text = {
        "ace_n": n0(len(ace)), "all_n": n0(len(req)), "chat_n": n0(len(chat)), "agent_n": n0(len(agent)),
        "agent_runs": n0(len({r["turn"] for r in agent})),
        "chat_max": n0(T["chat"]["max"]), "agent_max": n0(T["agent"]["max"]),
        "chat_med": n0(statistics.median(r["prompt"] for r in chat)),
        "chat_over": n0(T["chat"]["over"]), "agent_over": n0(T["agent"]["over"]),
        "chat_hit": pc(T["chat"]["hit"]), "agent_hit": pc(T["agent"]["hit"]), "all_hit": pc(T["all"]["hit"]),
        "chat_paid": money(T["chat"]["paid"]), "agent_paid": money(T["agent"]["paid"]), "all_paid": money(T["all"]["paid"]),
        "chat_unc": money(T["chat"]["unc"]), "agent_unc": money(T["agent"]["unc"]), "all_unc": money(T["all"]["unc"]),
        "saved": "%.0f%%" % (100 * (1 - T["all"]["paid"] / T["all"]["unc"])),
        "over_n": n0(len(over)), "over_usd": money(sum(usd(r) for r in over)),
        "over_each": money(statistics.median(usd(r) for r in over)) if over else "-",
        "over_share": pc(sum(usd(r) for r in over) / T["all"]["paid"]), "over_req_share": pc(len(over) / len(req)),
        "over_low": money(sum((r["in"] * LOW[0] + r["cr"] * LOW[1] + r["cw"] * LOW[2] + r["out"] * LOW[3]) / 1e6 for r in over)),
        "base": n0(base), "rewrites": n0(len(rewrites)), "rewrite_tok": n0(statistics.median(r["cw"] for r in rewrites)),
        "rewrite_usd": money(statistics.median(usd(r) for r in rewrites)), "folds": n0(len(folds)),
        "raw_max": "%.1fM" % (max(raw) / 1e6), "raw_first": n0(1 + bisect.bisect_left(begins, next(ts for (ts, _), v in zip(ace, raw) if v > STEP) - 1)),
        "after": ", ".join(n0(r["prompt"]) for r in after) or "-", "after_n": n0(len(after)),
        "span": "%d h %d min" % (span // 3600, span % 3600 // 60),
        "dur_hit": "%.1f s" % med([r for r in chat if r["cr"] > base]), "dur_rewrite": "%.1f s" % med(rewrites),
        "date": time.strftime("%Y-%m-%d", time.localtime(start)), "session": args.session,
    }

    # The film: scenes in order. cam: the requests that the picture shows (first, last); p: how many requests are drawn at the
    # start and at the end of the scene; say: the words (the captions, and the text that src/voice.py has spoken);
    # notes: [the sentence that brings it, the request it points at, its text]. speak: the same sentences as the voice reads
    # them, where figures need words (dollars, thousands); the captions stay say.
    word = lambda n: ("zero one two three four five six seven eight nine ten eleven twelve".split() + [str(n)] * 99)[min(n, 13)] if n < 13 else str(n)
    k0 = lambda x: n0(round(x, -3))
    pct = lambda p: p.replace("0.", "zero point ", 1).replace("%", " percent") if p.startswith("0.") else p.replace("%", " percent")
    spoken = lambda x: "%d dollars and %d cents" % (int(round(x * 100)) // 100, int(round(x * 100)) % 100)
    fold = next(i for i, r in enumerate(chat) if r["cr"] == base and i)  # the first request that wrote the cache again after a fold
    scenes = [
        {"k": "intro", "cam": [-0.5, 13.5], "p": [0, fold], "notes": [],
         "say": "This is one chat on Claude Haiku 5.5. Each column is one request. Teal is what it read from the cache. Yellow is what it wrote."},
        {"k": "step", "cam": [-0.5, 13.5], "p": [fold, fold], "notes": [],
         "say": "The dashed line is Anthropic's price step. A request over 100,000 tokens pays five times the price, on every token."},
        {"k": "fold", "cam": [-0.5, 13.5], "p": [fold, fold + 7], "notes": [[2, fold, "reads %s, writes %s" % (n0(req[fold]["cr"]), n0(req[fold]["cw"]))]],
         "say": "breadcrumbs holds the chat under a ceiling of 94,000. When the next request would pass it, breadcrumbs folds the chat. That request reads the "
                "fixed prefix from the cache and writes the rest again. Nothing is lost: every line stays in memory under its address."},
        {"k": "whole", "cam": [0, len(req)], "p": [fold + 7, len(req)], "notes": [],
         "say": "Now the whole chat: %s requests in %d hours and %d minutes. With nothing folded it would have reached %s million tokens. breadcrumbs folded it "
                "%s times, and no request of the chat passed 100,000." % (text["all_n"], span // 3600, span % 3600 // 60, "%.1f" % (max(raw) / 1e6), text["folds"])},
    ]
    if over:
        i = req.index(over[0])
        cents = round(usd(over[0]) * 100)
        scenes.append({"k": "spike", "cam": [i - 7.5, i + 7.5], "p": [len(req), len(req)],
                       "notes": [[3, i, "%s tokens" % n0(over[0]["prompt"])], [4, i, money(usd(over[0]))]],
                       "say": "%s requests did pass it. None of them is the chat's. The harness starts a second agent when a turn ends. It began cold and sent %s tokens. "
                              "That one request cost %d cents: as much as %d folds."
                              % (word(len(over)).capitalize(), k0(over[0]["prompt"]), cents, round(usd(over[0]) / statistics.median(usd(r) for r in rewrites)))})
    if over and after:
        opened = [k0(r["prompt"]) for r in after]
        scenes.append({"k": "fix", "cam": [req.index(over[-1]) - 30, len(req)], "p": [len(req), len(req)],
                       "notes": [[2, req.index(r), n0(r["prompt"])] for r in after],
                       "say": "The chart showed why: that agent sized its first request with a default that was too low. The default was corrected in the source. "
                              "Its next %s runs opened at %s tokens: under the line." % (word(len(after)), ", ".join(opened[:-1]) + " and " + opened[-1] if len(opened) > 1 else opened[0]),
                       "speak": "The chart showed why: that agent sized its first request with a default that was too low. The default was corrected in the source. "
                                "Its next %s runs opened at %s tokens: under the line."
                                % (word(len(after)), ", then ".join("%d thousand" % round(r["prompt"] / 1000) for r in after))})
    scenes.append({"k": "measures", "cam": [0, len(req)], "p": [len(req), len(req)], "notes": [],
                   "say": "The measures. %s of all input tokens were read from the cache. The bill was %s. The same tokens with no cache: %s. And the %s requests over the line, "
                          "%s of the requests, made up %s of the bill." % (text["all_hit"], text["all_paid"], text["all_unc"], word(len(over)), text["over_req_share"], text["over_share"]),
                   "speak": "The measures. %s of all input tokens were read from the cache. The bill was %s. The same tokens with no cache: %s. And the %s requests over the line, "
                            "%s of the requests, made up %s of the bill."
                            % (pct(text["all_hit"]), spoken(T["all"]["paid"]), spoken(T["all"]["unc"]), word(len(over)), pct(text["over_req_share"]), pct(text["over_share"]))})
    scenes.append({"k": "open", "cam": [0, len(req)], "p": [len(req), len(req)], "notes": [],
                   "say": "Every number here comes from two log files and a chart that anyone can read and change. That is what open source gives you: you see where the money goes, "
                          "and you change the code that spends it. The outcome is yours to set."})
    tok = sum(r["prompt"] for r in req)
    total_sum = {"n": len(req), "hit": sum(r["cr"] for r in req) / tok, "write": sum(r["cw"] for r in req) / tok, "paid": T["all"]["paid"], "unc": T["all"]["unc"],
                 "over_n": len(over), "over_req": len(over) / len(req), "over_bill": sum(usd(r) for r in over) / T["all"]["paid"]}

    data = {
        "session": args.session, "model": "Claude Haiku 5.5", "date": text["date"], "step": STEP, "ceiling": 94000, "base": base,
        "prices": {"low": LOW, "high": HIGH},
        # one row for each request, oldest first: seconds from the start, cache read, cache write, uncached input, output,
        # 1 for the second agent, millionths of a dollar paid, millionths of a dollar for the same tokens with no cache
        "req": [[round(r["t0"] - start), r["cr"], r["cw"], r["in"], r["out"], int(r["side"]), round(usd(r) * 1e6), round(usd(r, True) * 1e6)] for r in req],
        # one row for each decision of the context engine: its place on the axis of requests, the chat with nothing folded
        # (the engine's estimate, tokens), what it sent (estimate), 1 for a fold
        "ace": [[round(bisect.bisect_left(begins, ts - 1) + 0.0, 0), int(kv["in"]), int(kv["out"]), int(kv.get("act") == "fold")] for ts, kv in ace],
        "scenes": scenes, "sum": total_sum, "text": text,
    }
    with open(os.path.join(HERE, "haiku-run.js"), "w", encoding="utf-8") as f:
        f.write("// Made by src/make.py from the logs of one chat. Numbers only.\nwindow.HAIKU_RUN = " + json.dumps(data, separators=(",", ":")) + ";\n")
    page = os.path.join(HERE, "index.html")
    with open(page, encoding="utf-8") as f:
        html = f.read()
    missing = []
    for key in sorted(set(re.findall(r'data-k="(\w+)"', html))):
        if key not in text:
            missing.append(key)
            continue
        html = re.sub(r'(data-k="%s"[^>]*>)[^<]*(<)' % key, lambda m: m.group(1) + text[key] + m.group(2), html)
    if missing:
        raise SystemExit("index.html asks for numbers that make.py does not give: " + ", ".join(missing))
    with open(page, "w", encoding="utf-8") as f:
        f.write(html)
    print(json.dumps(text, indent=1))
    for sc in scenes:
        print("%-8s cam %s p %s notes %s\n         %s" % (sc["k"], sc["cam"], sc["p"], sc["notes"], sc["say"]))
    print("characters to speak:", sum(len(sc["say"]) for sc in scenes))


if __name__ == "__main__":
    main()
