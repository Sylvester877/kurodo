import re

path = 'repo/server/lib/cf-harvester/puppeteer.js'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

start_marker = '  async function _extractStreamImpl(watchUrl, options = {}) {'
start = text.find(start_marker)
if start == -1:
    print('start not found')
    raise SystemExit(1)

end_match = re.search(r'\n  }\n\n  async function exportCookiesImpl', text)
if not end_match:
    print('end not found')
    raise SystemExit(1)
end = end_match.start() + len('\n  }')

func = text[start:end]

split1 = '    // ── Gogoanime retry loop with proxy rotation ─────────────────────'
idx1 = func.find(split1)
if idx1 == -1:
    print('split1 not found')
    raise SystemExit(1)
head = func[:idx1]
mid_tail = func[idx1:]

split2 = '    console.log(`[cf-harvester] DOM extraction: ${watchUrl.slice(0, 100)}`)'
idx2 = mid_tail.find(split2)
if idx2 == -1:
    print('split2 not found')
    raise SystemExit(1)
retry_part = mid_tail[:idx2]
logic_part = mid_tail[idx2:]

wrapper = head.replace('async function _extractStreamImpl', 'async function _doExtractStream')
wrapper = wrapper.replace('return await _extractStreamImpl(watchUrl, options)', 'return await __doExtract(watchUrl, options)')
wrapper = wrapper + retry_part + '\n  }'

helper = '  async function __doExtract(watchUrl, options = {}) {\n    const totalBudgetMs = options.maxDurationMs ?? 30_000\n    const remainingBudget = makeRemainingBudget(Date.now(), totalBudgetMs)\n    const isGogo = watchUrl.includes(\'gogoanime\')\n' + logic_part

new_func = wrapper + '\n\n' + helper
new_text = text[:start] + new_func + text[end:]
new_text = new_text.replace('_extractStreamImpl(watchUrl, options)', '_doExtractStream(watchUrl, options)')

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_text)
print('fixed recursion')
