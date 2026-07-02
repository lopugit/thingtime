#!/usr/bin/env python3
"""Bundle a Claude Design (.dc.html) export into one self-contained index.html.

Usage: python3 inline-dc.py <folder> ["Design Name.dc.html"]
       (defaults to the only .dc.html in the folder)

Inlines support.js + ds/ scripts and CSS. Payloads are JSON-escaped with all
'<' as \\u003c so the HTML parser can never mis-lex them. All scripts are
consolidated into <head> — React → DS bundle → tt-elements → support.js — so
React executes exactly once; helmet script tags are removed, which avoids the
double-React invalid-hook-call errors the raw export hits when support.js
re-appends helmet scripts (see thingtime-launch-celebration/README.md).
"""
import json, re, sys
from pathlib import Path

folder = Path(sys.argv[1])
if len(sys.argv) > 2:
    dc = folder / sys.argv[2]
else:
    dcs = sorted(folder.glob('*.dc.html'))
    assert len(dcs) == 1, f'expected exactly one .dc.html, found {dcs}'
    dc = dcs[0]

read = lambda p: (folder / p).read_text(encoding='utf-8')

def wrap(label, content):
    payload = json.dumps(content).replace('<', '\\u003c')
    return ('<script>/* inlined: %s */(function(){var s=document.createElement("script");'
            's.textContent=%s;document.head.appendChild(s);})();</script>' % (label, payload))

html = dc.read_text(encoding='utf-8')

# head: all scripts once, support.js last (its loadReactUmd() short-circuits
# on window.React; tt-elements polls until window.Thingtime is ready)
order = ['ds/react.js', 'ds/react-dom.js', 'ds/thingtime-bundle.js', 'ds/tt-elements.js', 'support.js']
tag = '<script src="./support.js"></script>'
assert html.count(tag) == 1
html = html.replace(tag, '\n'.join(wrap(f, read(f)) for f in order))

# helmet: css link -> <style>; drop script tags (already executed from head)
css_tag = '<link rel="stylesheet" href="ds/thingtime-bundle.css">'
if css_tag in html:
    css = read('ds/thingtime-bundle.css')
    assert '<' not in css
    html = html.replace(css_tag, '<style>/* inlined: ds/thingtime-bundle.css */%s</style>' % css)
for f in order[:4]:
    html = re.sub(r'\n?[ \t]*<script src="%s"></script>' % re.escape(f), '', html)

leftover = re.search(r'(src|href)="(?!https?://|#|mailto:)[^"]+"', html)
assert not leftover, f'local ref remains: {leftover.group(0)}'
(folder / 'index.html').write_text(html, encoding='utf-8')
print(f'{folder / "index.html"}: {len(html)} bytes')
