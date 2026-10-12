"""Optional UI smoke test: pip install playwright; use an installed Chromium binary.
Start `npm run web -- --no-open` first. Set CHROMIUM_PATH when needed.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs'
OUT.mkdir(exist_ok=True)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    offline = os.environ.get('AINCRAD_OFFLINE_TEST') == '1'
    def load_page(saved_storage=None):
        pg = browser.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.on('pageerror', lambda error: errors.append(str(error)))
        if offline:
            # This environment blocks navigations, including localhost. Execute the
            # actual self-contained build in an about:blank test document instead.
            # about:blank has no storage origin, so save I/O uses an in-memory adapter.
            pg.evaluate('''data => {
                window.__AINCRAD_TEST__ = true;
                window.__testStorage = {data,
                    getItem(k) { return this.data[k] ?? null; },
                    setItem(k,v) { this.data[k] = v; }
                };
                Object.defineProperty(window, 'localStorage', {value: window.__testStorage});
            }''', saved_storage or {})
            pg.set_content((ROOT / 'play.html').read_text())
        else:
            pg.goto('http://127.0.0.1:4173/?test=1')
        return pg
    page = load_page()
    page.wait_for_function('Boolean(window.__aincrad)')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / 'title-screen.png'))
    page.click('#begin')
    page.wait_for_timeout(1000)
    start = page.evaluate('window.__aincrad.snapshot()')
    page.keyboard.down('KeyD')
    page.wait_for_timeout(1000)
    page.keyboard.up('KeyD')
    moved = page.evaluate('window.__aincrad.snapshot()')
    assert moved['player']['x'] > start['player']['x'] + 80, (start, moved)
    page.evaluate('window.__aincrad.reset()')
    page.wait_for_timeout(800)
    page.screenshot(path=str(OUT / 'valley-preview.png'))
    # Exercise all three real cave transitions using E, not a direct scene assignment.
    for cave_id, x, y in [('lantern', -12000, -21700), ('amber', 14500, -21600), ('echo', 21400, 10700)]:
        assert page.evaluate('([x,y]) => window.__aincrad.teleport(x,y)', [x,y+70])
        page.wait_for_timeout(400)
        if cave_id == 'lantern':
            page.screenshot(path=str(OUT / 'mountain-preview.png'))
        page.keyboard.press('KeyE')
        page.wait_for_timeout(500)
        assert page.evaluate('window.__aincrad.snapshot().scene') == cave_id
        assert page.evaluate('window.__aincrad.teleport(1270,1070,"'+cave_id+'")')
        page.wait_for_timeout(500)
        if cave_id == 'lantern':
            page.screenshot(path=str(OUT / 'cave-preview.png'))
            page.keyboard.press('KeyM')
            page.wait_for_timeout(300)
            assert page.is_visible('#map-panel')
            page.screenshot(path=str(OUT / 'cave-map.png'))
            page.keyboard.press('KeyM')
        assert page.evaluate('window.__aincrad.teleport(1320,1510,"'+cave_id+'")')
        page.keyboard.press('KeyE')
        page.wait_for_timeout(300)
        s = page.evaluate('window.__aincrad.snapshot()')
        assert s['scene'] == 'valley'
        assert abs(s['player']['x']-x) < .01 and abs(s['player']['y']-(y+95)) < .01
    # Pause really stops the authoritative clock.
    page.keyboard.press('Escape')
    before_pause = page.evaluate('window.__aincrad.snapshot().elapsed')
    page.wait_for_timeout(300)
    assert page.evaluate('window.__aincrad.snapshot().elapsed') == before_pause
    page.keyboard.press('Escape')
    # Save / page reload preserves scene, position and all cave discoveries.
    page.keyboard.press('Control+s')
    saved = page.evaluate('window.__aincrad.snapshot()')
    if offline:
        storage_copy = page.evaluate('window.__testStorage.data')
        page.close()
        page = load_page(storage_copy)
    else:
        page.reload()
    page.wait_for_function('Boolean(window.__aincrad)')
    restored = page.evaluate('window.__aincrad.snapshot()')
    assert restored['player'] == saved['player']
    assert set(restored['visitedCaves']) == {'lantern','amber','echo'}
    page.click('#begin')
    page.keyboard.press('KeyM')
    page.wait_for_timeout(500)
    assert page.is_visible('#map-panel')
    page.screenshot(path=str(OUT / 'field-map.png'))
    # A real click places a waypoint.
    box = page.locator('#atlas-map').bounding_box()
    page.mouse.click(box['x'] + box['width']*.55, box['y'] + box['height']*.55)
    assert page.evaluate('window.__aincrad.snapshot().waypoint !== null')
    page.keyboard.press('KeyM')
    assert not page.is_visible('#map-panel')
    page.keyboard.press('KeyH')
    assert page.is_visible('#help-panel')
    page.keyboard.press('KeyH')
    assert not page.is_visible('#help-panel')
    print(json.dumps({'runtime_errors':errors,'state':page.evaluate('window.__aincrad.snapshot()'),'metrics':page.evaluate('window.__aincrad.metrics()')}, indent=2))
    assert not errors, errors
    browser.close()
print('PASS: movement; all three cave entries/exits; map; waypoint; guide; pause; save/reload.' + (' Save I/O used an in-memory adapter.' if offline else ''))
