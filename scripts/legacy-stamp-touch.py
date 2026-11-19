"""Patch the inlined signing editor still served by production. No network I/O."""

import argparse
import re
from pathlib import Path


def patch(source):
    start = b"        function setupDrawingEvents(canvas, pageNum) {"
    end = b"        function undoLastAction() {"
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError("Expected exactly one legacy signing handler")
    begin = source.index(start)
    finish = source.index(end, begin)
    handler = source[begin:finish]
    replacements = [
        (
            b"            canvas.addEventListener('mousedown', startDraw);",
            [
                b"            canvas.addEventListener('mousedown', event => {",
                b"                if (currentTool === 'stamp' && event.sourceCapabilities?.firesTouchEvents) return;",
                b"                startDraw(event);",
                b"            });",
            ],
        ),
        (
            b"            canvas.addEventListener('touchstart', startDraw, { passive: false });",
            [
                b"            canvas.addEventListener('touchstart', event => {",
                b"                if (currentTool === 'stamp') {",
                b"                    if (event.cancelable) event.preventDefault();",
                b"                    if (event.touches.length !== 1) return;",
                b"                }",
                b"                startDraw(event);",
                b"            }, { passive: false });",
            ],
        ),
    ]
    for before, after in replacements:
        pattern = rb"(?m)^" + re.escape(before) + rb"(\r?\n)"
        matches = list(re.finditer(pattern, handler))
        if len(matches) != 1:
            raise ValueError("Unexpected legacy signing event listeners; review before deploying")
        match = matches[0]
        newline = match.group(1)
        handler = handler[:match.start()] + newline.join(after) + newline + handler[match.end():]
    return source[:begin] + handler + source[finish:]


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("source", type=Path)
    cli.add_argument("output", type=Path)
    args = cli.parse_args()
    content = patch(args.source.read_bytes())
    with args.output.open("xb") as target:
        target.write(content)
