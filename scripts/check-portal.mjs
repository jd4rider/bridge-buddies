/**
 * Checks that Bridge Buddies is listed in the live Little Joy Arcade catalogue.
 *
 *   node scripts/check-portal.mjs
 */
import { chromium } from 'playwright'

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto('https://littlejoyarcade.site/', { waitUntil: 'networkidle', timeout: 60000 })
const card = page.getByText('Bridge Buddies').first()
console.log('catalogue card:', (await card.count()) > 0 ? 'present' : 'absent')

await page.goto('https://littlejoyarcade.site/#/game/bridge-buddies', {
  waitUntil: 'networkidle',
  timeout: 60000,
})
await page.waitForTimeout(2500)
const body = (await page.textContent('body')) ?? ''
console.log('detail page names the game:', body.includes('Bridge Buddies'))
console.log('detail page names Babylon.js:', body.includes('Babylon'))
console.log('play links:', await page.locator('a[href*="bridge-buddies"]').count())
await page.screenshot({ path: '/tmp/bb-portal.png' })
console.log('page errors:', errors.length > 0 ? errors.slice(0, 2) : 'none')
await browser.close()
