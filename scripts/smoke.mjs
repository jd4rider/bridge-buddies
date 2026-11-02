/**
 * Browser smoke test: loads the real build in a portrait phone viewport, builds
 * a Warren truss by tapping world points through the actual pointer pipeline,
 * presses TEST and checks a buddy crosses.
 *
 *   node scripts/smoke.mjs [url]
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5199/?debug=1'
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})
const page = await context.newPage()

const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

const shot = async (name) => {
  await page.screenshot({ path: `/tmp/bb-${name}.png` })
  console.log(`  screenshot /tmp/bb-${name}.png`)
}

await page.goto(url, { waitUntil: 'load' })
await page.waitForSelector('.menu h1', { timeout: 60000 })
await page.waitForFunction(() => window.__bb !== undefined, { timeout: 20000 })
console.log('menu rendered')
await shot('menu')

await page.click('[data-action="continue"]')
await page.waitForSelector('#toolbar:not(.hidden)', { timeout: 20000 })
console.log('level opened:', await page.textContent('#level-sub'))
console.log('objective:', (await page.textContent('#objective'))?.trim())
await page.waitForTimeout(600)
await shot('build-empty')

console.log('havok physics:', await page.evaluate(() => window.__bb.physics()))
const info = await page.evaluate(() => window.__bb.info())
console.log('geometry:', JSON.stringify(info))

const project = (x, y) => page.evaluate(([px, py]) => window.__bb.project(px, py), [x, y])
const tap = async (x, y) => {
  const point = await project(x, y)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(70)
}

const segments = 4
const deck = []
for (let i = 0; i <= segments; i++) {
  const t = i / segments
  deck.push({ x: info.gap * t, y: info.rightDeckY * t })
}

// Deck, tap by tap, through the real pointer handler.
for (let i = 0; i < segments; i++) {
  await tap(deck[i].x, deck[i].y)
  await tap(deck[i + 1].x, deck[i + 1].y)
}
console.log('deck cost:', (await page.textContent('#cost'))?.trim())

await page.click('[data-tool="beam"]')
const depth = 1.5
const bottom = []
for (let i = 0; i < segments; i++) {
  bottom.push({
    x: (deck[i].x + deck[i + 1].x) / 2,
    y: (deck[i].y + deck[i + 1].y) / 2 - depth,
  })
}
for (let i = 0; i < segments; i++) {
  await tap(deck[i].x, deck[i].y)
  await tap(bottom[i].x, bottom[i].y)
  await tap(deck[i + 1].x, deck[i + 1].y)
  await tap(bottom[i].x, bottom[i].y)
}
for (let i = 0; i < segments - 1; i++) {
  await tap(bottom[i].x, bottom[i].y)
  await tap(bottom[i + 1].x, bottom[i + 1].y)
}

const cost = (await page.textContent('#cost'))?.trim()
const budget = (await page.textContent('#budget-money'))?.trim()
console.log('built:', cost, '/', budget)
await shot('build-truss')

await page.click('#test')
await page.waitForTimeout(1400)
await shot('testing')
await page.waitForFunction(
  () => !document.querySelector('#result')?.classList.contains('hidden'),
  { timeout: 30000 },
)
const heading = (await page.textContent('#result h2'))?.trim()
const reason = (await page.textContent('#result .reason'))?.trim()
console.log('result:', heading, '—', reason)
await shot('result')

await browser.close()

if (errors.length > 0) {
  console.error('\nBrowser errors:')
  for (const error of errors) console.error(' ', error)
  process.exit(1)
}
if (heading !== 'Across!') {
  console.error(`\nExpected a crossing, got "${heading}"`)
  process.exit(1)
}
console.log('\nSmoke test passed: built a truss by tapping and drove across.')
