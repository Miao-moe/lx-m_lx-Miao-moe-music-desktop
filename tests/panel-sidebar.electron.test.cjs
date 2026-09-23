const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const width = locator => locator.evaluate(element => element.getBoundingClientRect().width)
const panel = (page, name) => page.locator(`[data-panel-sidebar="${name}"]`)
const toggle = (page, name) => panel(page, name).locator(`button[aria-controls="panel-sidebar-${name}"]`)
const textMetrics = locator => locator.evaluate(element => {
  const style = window.getComputedStyle(element)
  return { fontSize: style.fontSize, lineHeight: style.lineHeight, textOverflow: style.textOverflow }
})
const assertResizeBoundary = async sidebar => {
  const position = await sidebar.evaluate(element => {
    const edge = element.getBoundingClientRect().right
    const handle = element.querySelector('[data-panel-sidebar-resize]')
    const rect = handle.getBoundingClientRect()
    const line = window.getComputedStyle(handle, '::before')
    const offset = line.transform === 'none' ? 0 : new window.DOMMatrix(line.transform).m41
    const scroll = element.querySelector('ul.scroll')
    const scrollRect = scroll.getBoundingClientRect()
    const scrollWidth = parseFloat(window.getComputedStyle(scroll, '::-webkit-scrollbar').width)
    return {
      edge,
      contentEdge: element.nextElementSibling.getBoundingClientRect().left,
      toggleEdge: element.querySelector('button[aria-controls]').getBoundingClientRect().right,
      handleLeft: rect.left,
      handleRight: rect.right,
      lineCenter: rect.x + parseFloat(line.left) + parseFloat(line.width) / 2 + offset,
      reachable: document.elementFromPoint(edge, rect.y + rect.height / 2) === handle,
      sidebarContentEdge: element.querySelector('[id^="panel-sidebar-"]').getBoundingClientRect().right,
      scrollbarReachable: document.elementFromPoint(scrollRect.right - scrollWidth / 2, scrollRect.y + scrollRect.height / 2) === scroll,
    }
  })
  assert.ok(position.handleLeft <= position.edge && position.handleRight > position.edge, `resize hit area must include the sidebar edge: ${JSON.stringify(position)}`)
  assert.ok(Math.abs(position.lineCenter - position.contentEdge) < 1, 'the visible divider must align with the song list edge')
  assert.ok(Math.abs(position.toggleEdge - position.edge) < 1, 'the collapse button must stay at the right edge instead of covering the sidebar title')
  assert.ok(Math.abs(position.sidebarContentEdge - position.edge) < 1, 'sidebar contents must use the space below the collapse button')
  assert.equal(position.reachable, true, 'dragging at the sidebar boundary must reach the resize handle')
  assert.equal(position.scrollbarReachable, true, 'the resize handle and collapse control must not cover the scrollbar')
}
const drag = async(page, separator, distance, cancel = false) => {
  const box = await separator.boundingBox()
  const x = await separator.evaluate(element => element.closest('[data-panel-sidebar]').getBoundingClientRect().right)
  const y = box.y + Math.min(100, box.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + distance, y, { steps: 10 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}
const expectWidth = (page, name, value) => page.waitForFunction(({ name, value }) => Math.abs(document.querySelector(`[data-panel-sidebar="${name}"]`).getBoundingClientRect().width - value) < 1, { name, value })
const sampleTransition = sidebar => sidebar.evaluate(element => {
  const animations = element.getAnimations()
  const animation = animations.find(animation => animation.transitionProperty === 'width')
  if (!animation) return null
  const duration = animation.effect.getTiming().duration
  for (const animation of animations) {
    animation.pause()
    animation.currentTime = duration / 2
  }
  const sample = { duration, width: element.getBoundingClientRect().width }
  for (const animation of animations) animation.play()
  return sample
})
const open = async(page, name) => {
  await route(page, name === 'myList' ? '/list?id=history' : '/leaderboard?source=wy&boardId=wy__19723756')
  await settled(page)
  await toggle(page, name).waitFor()
}

test('playlist and leaderboard sidebars resize without scaling text and retain independent collapsed states', { timeout: 60000 }, async t => {
  const server = http.createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ code: 200, playlist: { trackIds: [] }, songs: [], privileges: [] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture
  const saved = {}
  const start = async profilePath => {
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    fixture.page.setDefaultTimeout(5000)
    await fixture.page.evaluate(port => {
      const http = require('http')
      const https = require('https')
      const original = https.request
      https.request = function(options, callback) {
        if ((options.hostname ?? options.host) === 'music.163.com') {
          return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined }, callback)
        }
        return original.apply(this, arguments)
      }
    }, server.address().port)
  }
  try {
    await start()
    const { page, app, output } = fixture
    await page.evaluate(() => require('electron').ipcRenderer.invoke('player_list_add', { position: 0, listInfos: [{ id: 'sidebar-long-name', name: 'Long playlist title '.repeat(12), locationUpdateTime: null }] }))

    for (const name of ['myList', 'leaderboard']) {
      await t.test(`${name}: dragging changes available text space, supports cancellation, and can collapse`, async() => {
        await open(page, name)
        const sidebar = panel(page, name)
        const separator = sidebar.getByRole('separator')
        const label = name === 'myList' ? sidebar.locator('[data-id="sidebar-long-name"] > span') : sidebar.locator('ul > li > span').first()
        await label.waitFor()
        const before = await textMetrics(label)
        const beforeWidth = await width(sidebar)
        const beforeLabelWidth = await width(label)
        await assertResizeBoundary(sidebar)
        await drag(page, separator, name === 'myList' ? 90 : 65)
        await page.waitForFunction(key => window.lxData.appSetting[key] > 0, `ui.${name}Sidebar.width`)
        assert.ok(await width(sidebar) > beforeWidth + 50)
        assert.ok(await width(label) > beforeLabelWidth + 50)
        assert.deepEqual(await textMetrics(label), before)
        await assertResizeBoundary(sidebar)
        assert.equal(before.textOverflow, 'ellipsis')
        saved[name] = await width(sidebar)
        await drag(page, separator, -35, true)
        await expectWidth(page, name, saved[name])
        assert.equal(await page.locator('html').evaluate(element => element.classList.contains('panel-sidebar-resizing')), false)
        const contentWidth = await width(sidebar.locator('xpath=following-sibling::*[1]'))
        await toggle(page, name).focus()
        await page.keyboard.press('Space')
        const closing = await sampleTransition(sidebar)
        assert.equal(closing?.duration, 240)
        assert.ok(closing.width > 24 && closing.width < saved[name])
        assert.deepEqual(await textMetrics(label), before)
        await expectWidth(page, name, 24)
        await label.waitFor({ state: 'hidden' })
        assert.ok(await width(sidebar.locator('xpath=following-sibling::*[1]')) > contentWidth + 100)
        await toggle(page, name).press('Enter')
        const opening = await sampleTransition(sidebar)
        assert.equal(opening?.duration, 240)
        assert.ok(opening.width > 24 && opening.width < saved[name])
        await expectWidth(page, name, saved[name])
        assert.deepEqual(await textMetrics(label), before)
        await assertResizeBoundary(sidebar)
        await page.screenshot({ path: path.resolve(`logs/panel-sidebar-${name}.png`) })
        if (name === 'myList') await toggle(page, name).click()
      })
    }

    await t.test('width and collapse state survive navigation and a full restart independently', async() => {
      await open(page, 'myList')
      await expectWidth(page, 'myList', 24)
      assert.equal(await app.evaluate(() => global.lx.appSetting['ui.myListSidebar.collapsed']), true)
      assert.equal(await app.evaluate(() => global.lx.appSetting['ui.leaderboardSidebar.collapsed']), false)
      assert.deepEqual(fixture.errors, [])
      fixture = null
      await app.close()
      await start(output)
      await open(fixture.page, 'myList')
      await expectWidth(fixture.page, 'myList', 24)
      await toggle(fixture.page, 'myList').click()
      await expectWidth(fixture.page, 'myList', saved.myList)
      await open(fixture.page, 'leaderboard')
      await expectWidth(fixture.page, 'leaderboard', saved.leaderboard)
    })

    await t.test('keyboard and pointer resizing respect bounds and double-click restores the default', async() => {
      const page = fixture.page
      const sidebar = panel(page, 'leaderboard')
      const separator = sidebar.getByRole('separator')
      const label = sidebar.locator('ul > li > span').first()
      const before = await textMetrics(label)
      await separator.press('Home')
      await expectWidth(page, 'leaderboard', 140)
      await separator.press('End')
      await expectWidth(page, 'leaderboard', Number(await separator.getAttribute('aria-valuemax')))
      assert.ok(await width(sidebar) <= 420)
      await drag(page, separator, 1000)
      assert.ok(await width(sidebar) <= 420)
      await separator.dblclick()
      await page.waitForFunction(() => window.lxData.appSetting['ui.leaderboardSidebar.width'] === 0)
      assert.deepEqual(await textMetrics(label), before)
      await page.setViewportSize({ width: 828, height: 540 })
      await separator.press('End')
      await expectWidth(page, 'leaderboard', Number(await separator.getAttribute('aria-valuemax')))
      const sidebarWidth = await width(sidebar)
      const parentWidth = await width(sidebar.locator('..'))
      assert.ok(sidebarWidth <= parentWidth / 2 + 1)
      assert.ok(parentWidth - sidebarWidth >= 280)
      await toggle(page, 'leaderboard').click()
      await open(page, 'myList')
      assert.equal(await toggle(page, 'myList').getAttribute('aria-expanded'), 'true')
    })
    await t.test('collapse animation reverses cleanly and follows the existing motion controls', async() => {
      const page = fixture.page
      const sidebar = panel(page, 'myList')
      const button = toggle(page, 'myList')
      const expandedWidth = await width(sidebar)
      for (let index = 0; index < 6; index++) {
        await button.dispatchEvent('click')
        await page.waitForTimeout(35)
      }
      await expectWidth(page, 'myList', expandedWidth)
      assert.equal(await button.getAttribute('aria-expanded'), 'true')
      await page.locator('#panel-sidebar-myList').waitFor({ state: 'visible' })
      await page.waitForFunction(() => document.querySelector('[data-panel-sidebar="myList"]').getAnimations().length === 0)
      await page.evaluate(() => window.lxData.updateSetting({ 'ui.animationSpeed': 1.5 }))
      await page.waitForFunction(() => document.documentElement.dataset.motionSpeed === '1.5')
      await button.dispatchEvent('click')
      assert.equal((await sampleTransition(sidebar))?.duration, 160)
      await page.evaluate(() => window.lxData.updateSetting({ 'ui.smoothAnimation': false }))
      await page.waitForFunction(() => document.documentElement.dataset.motionEnabled === 'false')
      await expectWidth(page, 'myList', 24)
      await button.dispatchEvent('click')
      await expectWidth(page, 'myList', expandedWidth)
      assert.equal(await sidebar.evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length), 0)
      await page.evaluate(() => window.lxData.updateSetting({ 'ui.smoothAnimation': true, 'ui.animationSpeed': 1 }))
    })
    await t.test('collapsed sidebars retain a compact expand button and release the column to the list', async() => {
      const page = fixture.page
      const clickAt = async(button, fraction) => {
        const point = await button.evaluate((element, fraction) => {
          const rect = element.getBoundingClientRect()
          const x = rect.x + rect.width / 2
          const y = rect.y + rect.height * fraction
          return { x, y, reachable: element.contains(document.elementFromPoint(x, y)) }
        }, fraction)
        assert.equal(point.reachable, true, 'the expand control must not be covered by neighboring content')
        await page.mouse.click(point.x, point.y)
      }
      for (const size of [{ width: 828, height: 540, font: 14 }, { width: 1114, height: 718, font: 19 }]) {
        await page.setViewportSize({ width: size.width, height: size.height })
        await page.evaluate(font => window.lxData.updateSetting({ 'common.fontSize': font }), size.font)
        for (const name of ['myList', 'leaderboard']) {
          await open(page, name)
          const sidebar = panel(page, name)
          const button = toggle(page, name)
          if (await button.getAttribute('aria-expanded') === 'false') await button.click()
          await page.waitForFunction(name => document.querySelector(`[data-panel-sidebar="${name}"]`).getAnimations().length === 0, name)
          const expandedWidth = await width(sidebar)
          const collapseButtonRect = await button.boundingBox()
          for (const fraction of [0.02, 0.5, 0.98]) {
            await button.click()
            await expectWidth(page, name, 24)
            await page.locator(`#panel-sidebar-${name}`).waitFor({ state: 'hidden' })
            await button.locator('svg').waitFor({ state: 'visible' })
            const rect = await button.boundingBox()
            assert.equal((await button.textContent()).trim(), '')
            assert.equal(rect.width, collapseButtonRect.width, 'expand and collapse buttons should have the same width')
            assert.equal(rect.height, collapseButtonRect.height, 'expand and collapse buttons should have the same height')
            const content = sidebar.locator('xpath=following-sibling::*[1]')
            assert.ok(Math.abs(await width(content) - await width(sidebar.locator('..'))) < 1, 'the song list should use the full page width')
            assert.equal(await content.evaluate((element, rect) => element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height + 40)), rect), true, 'the area below the button must belong to the song list')
            if (fraction === 0.5) {
              await page.mouse.move(10, 10)
              await page.screenshot({ path: path.resolve(`logs/panel-sidebar-expand-${name}-${size.width}.png`) })
            }
            await clickAt(button, fraction)
            await expectWidth(page, name, expandedWidth)
            assert.equal(await button.getAttribute('aria-expanded'), 'true')
            await page.locator(`#panel-sidebar-${name}`).waitFor({ state: 'visible' })
            await assertResizeBoundary(sidebar)
          }
        }
      }
    })
    await t.test('collapsed controls survive repeated navigation and keep the song list clickable', async() => {
      const page = fixture.page
      for (const name of ['myList', 'leaderboard']) {
        await open(page, name)
        if (await toggle(page, name).getAttribute('aria-expanded') === 'true') await toggle(page, name).click()
        await expectWidth(page, name, 24)
      }
      for (const mode of ['together', 'progressive', 'immediate']) {
        await page.evaluate(mode => window.lxData.updateSetting({ 'list.loadingMode': mode }), mode)
        for (const id of ['Setting', 'List', 'Leaderboard', 'List', 'Setting', 'Leaderboard']) {
          await page.locator(`[data-sidebar-nav="${id}"] a`).click()
          await settled(page)
          if (id === 'Setting') continue
          const name = id === 'List' ? 'myList' : 'leaderboard'
          const sidebar = panel(page, name)
          const button = toggle(page, name)
          await button.waitFor({ state: 'visible' })
          assert.equal(await button.getAttribute('aria-expanded'), 'false')
          const rect = await button.boundingBox()
          assert.ok(await width(sidebar) >= rect.width, 'the restored expand control needs a nonzero containing box')
          const content = sidebar.locator('xpath=following-sibling::*[1]')
          assert.ok(Math.abs(await width(content) - await width(sidebar.locator('..'))) < 1)
          assert.equal(await content.evaluate((element, rect) => element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height + 40)), rect), true)
          await page.screenshot({ path: path.resolve(`logs/panel-sidebar-return-${name}-${mode}.png`) })
          await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
          await page.waitForFunction(name => document.querySelector(`button[aria-controls="panel-sidebar-${name}"]`).getAttribute('aria-expanded') === 'true', name)
          await button.click()
          await expectWidth(page, name, 24)
        }
      }
      // Navigate away before the collapse transition finishes, then immediately return.
      await open(page, 'myList')
      await toggle(page, 'myList').click()
      await page.waitForFunction(() => document.querySelector('[data-panel-sidebar="myList"]').getAnimations().length === 0)
      await toggle(page, 'myList').click()
      await page.locator('[data-sidebar-nav="Leaderboard"] a').click()
      await page.locator('[data-sidebar-nav="List"] a').click()
      await settled(page)
      assert.equal(await toggle(page, 'myList').getAttribute('aria-expanded'), 'false')
      await toggle(page, 'myList').click()
      await page.waitForFunction(() => document.querySelector('button[aria-controls="panel-sidebar-myList"]').getAttribute('aria-expanded') === 'true')
    })
    assert.deepEqual(fixture.errors, [])
  } finally {
    if (fixture) await fixture.app.close()
    await new Promise(resolve => server.close(resolve))
  }
})
