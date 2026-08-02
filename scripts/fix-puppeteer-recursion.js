const fs = require('fs')
const path = 'repo/server/lib/cf-harvester/puppeteer.js'
let text = fs.readFileSync(path, 'utf8')

const startMarker = '  async function _extractStreamImpl(watchUrl, options = {}) {'
const start = text.indexOf(startMarker)
if (start === -1) { console.log('start not found')
process.exit(1) }

const endMatch = text.search(/\n  }\n\n  async function exportCookiesImpl/)
if (endMatch === -1) { console.log('end not found')
process.exit(1) }
const end = endMatch + 4

let func = text.slice(start, end)

const split1 = '    // ── Gogoanime retry loop with proxy rotation ─────────────────────'
const idx1 = func.indexOf(split1)
if (idx1 === -1) { console.log('split1 not found')
process.exit(1) }
const head = func.slice(0, idx1)
const midTail = func.slice(idx1)

const split2 = '    console.log(`[cf-harvester] DOM extraction: ${watchUrl.slice(0, 100)}`)'
const idx2 = midTail.indexOf(split2)
if (idx2 === -1) { console.log('split2 not found')
process.exit(1) }
const retryPart = midTail.slice(0, idx2)
const logicPart = midTail.slice(idx2)

let wrapper = head.replace('async function _extractStreamImpl', 'async function _doExtractStream')
wrapper = wrapper.replace('return await _extractStreamImpl(watchUrl, options)', 'return await __doExtract(watchUrl, options)')
wrapper = wrapper + retryPart + '\n  }'

const helper = '  async function __doExtract(watchUrl, options = {}) {\n    const totalBudgetMs = options.maxDurationMs ?? 30_000\n    const remainingBudget = makeRemainingBudget(Date.now(), totalBudgetMs)\n    const isGogo = watchUrl.includes(\'gogoanime\')\n' + logicPart

const newFunc = wrapper + '\n\n' + helper
let newText = text.slice(0, start) + newFunc + text.slice(end)
newText = newText.replace(/_extractStreamImpl\(watchUrl, options\)/g, '_doExtractStream(watchUrl, options)')
fs.writeFileSync(path, newText, 'utf8')
console.log('fixed recursion')
