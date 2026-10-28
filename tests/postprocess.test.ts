import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  postprocess,
  type PostprocessOptions,
  type PostprocessRule,
  type RuleSwitches
} from '../src/core/postprocess'
import { MASK_SENTINELS, maskSpans } from '../src/core/postprocess/rules'

function clean(text: string, options?: PostprocessOptions): string {
  return postprocess(text, options).text
}

/** Assert both the cleaned text and the rule ids that were reported. */
function expectCase(
  input: string,
  expected: string,
  applied: string[] = [],
  options?: PostprocessOptions
): void {
  const result = postprocess(input, options)
  expect(result.text).toBe(expected)
  expect(result.applied).toEqual(applied)
}

describe('postprocess: normalisation', () => {
  it.each([
    ['ＡＢＣ１２３', 'ABC123'],
    ['  hello   world  ', 'hello world'],
    ['你好,世界!', '你好，世界！'],
    ['Hello， world。', 'Hello, world.'],
    ['I said 中文， ok。', 'I said 中文, ok.'],
    ['Hello , world', 'Hello, world'],
    ['你好 。', '你好。']
  ])('normalises %j to %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('keeps code-like tokens byte-for-byte', () => {
    const cases = [
      '运行 `pnpm test`，然后升级到 v1.2.3。',
      'Set foo_bar to 1.5, then run npm.',
      'Call parse(text) at 16 kHz.',
      'Mail dev@example.com about https://example.com/a?b=1.',
      'Check /usr/local/bin and --strict before ship.'
    ]
    for (const input of cases) expect(clean(input)).toBe(input)
  })

  it('does not turn an abbreviation dot into a Chinese full stop', () => {
    expect(clean('比如说 e.g. 这样，很好。')).toBe('比如说 e.g. 这样，很好。')
  })

  it('reports normalisation as the applied rule', () => {
    expectCase(' 你好 ', '你好', ['normalize'])
  })
})

describe('postprocess: filler removal', () => {
  it.each([
    ['嗯，我觉得可以。', '我觉得可以。'],
    ['那个，我们走吧。', '我们走吧。'],
    ['就是说，明天见。', '明天见。'],
    ['啊，好吧。', '好吧。'],
    ['嗯，I think um we should go.', 'I think we should go.'],
    ['Um, I think we should ship it.', 'I think we should ship it.'],
    ['I think, um, we should ship it.', 'I think we should ship it.'],
    ['I, like, think it works.', 'I think it works.']
  ])('removes fillers from %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it.each([
    // A filler inside a real word or a real phrase is untouched.
    ['我今天嗯去了。', '我今天嗯去了。'],
    ['那个东西很好。', '那个东西很好。'],
    ['好啊。', '好啊。'],
    ['her umbrella', 'her umbrella'],
    ['I like it.', 'I like it.'],
    ['Do you know what I mean?', 'Do you know what I mean?']
  ])('keeps non-filler %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('removes an ambiguous filler only when punctuation sets it off', () => {
    expect(clean('You know, it works.')).toBe('It works.')
    expect(clean('It is, you know, fine.')).toBe('It is fine.')
  })

  it('is individually disableable', () => {
    expect(clean('嗯，我觉得可以。', { rules: { filler: false } })).toBe('嗯，我觉得可以。')
  })
})

describe('postprocess: self-corrections', () => {
  it.each([
    ['周一发，不对，周二发。', '周二发。'],
    ['我是说，明天发。', '明天发。'],
    ['先做A，然后B，不对，我是说C。', '先做A，C。'],
    ['Send it Monday, no wait, Tuesday.', 'Tuesday.'],
    ['I mean, Tuesday.', 'Tuesday.'],
    ['No wait... Tuesday.', 'Tuesday.'],
    ['First we test. Send it Monday. No wait, Tuesday.', 'First we test. Tuesday.']
  ])('drops the abandoned fragment in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it.each([
    ['这个不对。', '这个不对。'],
    ['不对。', '不对。'],
    ['The fact that I mean it is fine.', 'The fact that I mean it is fine.']
  ])('keeps a marker-shaped phrase in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('is individually disableable', () => {
    expect(clean('周一发，不对，周二发。', { rules: { 'self-correction': false } })).toBe(
      '周一发，不对，周二发。'
    )
  })
})

describe('postprocess: repetition collapse', () => {
  it.each([
    ['我我我觉得可以。', '我觉得可以。'],
    ['the the plan is ready.', 'the plan is ready.'],
    ['The The plan is ready.', 'The plan is ready.']
  ])('collapses repeats in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it.each([
    ['谢谢你的帮助。', '谢谢你的帮助。'],
    ['妈妈和爸爸来了。', '妈妈和爸爸来了。'],
    ['默默无闻', '默默无闻'],
    ['冉冉升起', '冉冉升起'],
    ['匆匆忙忙', '匆匆忙忙'],
    ['津津有味', '津津有味'],
    ['欣欣向荣', '欣欣向荣'],
    ['哈哈哈', '哈哈哈'],
    ['I had had enough.', 'I had had enough.'],
    ['Wait...', 'Wait...']
  ])('keeps legitimate repetition in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('defaults Han runs to 3 and keeps Latin word repeats at 2', () => {
    expect(clean('我我走了。')).toBe('我我走了。')
    expect(clean('我我我走了。')).toBe('我走了。')
    expect(clean('the the plan')).toBe('the plan')
  })

  it('clamps the Han threshold to a floor of 3', () => {
    expect(clean('我我走了。', { repetitionThreshold: 2 })).toBe('我我走了。')
    expect(clean('我我我走了。', { repetitionThreshold: 2 })).toBe('我走了。')
  })

  it('honours the configurable threshold', () => {
    expect(clean('我我走了。', { repetitionThreshold: 3 })).toBe('我我走了。')
    expect(clean('我我我走了。', { repetitionThreshold: 3 })).toBe('我走了。')
    expect(clean('the the the plan', { repetitionThreshold: 3 })).toBe('the plan')
  })

  it('is individually disableable', () => {
    expect(clean('我我我觉得可以。', { rules: { repetition: false } })).toBe('我我我觉得可以。')
  })
})

describe('postprocess: punctuation runs', () => {
  it.each([
    ['他说……', '他说……'],
    ['他说...', '他说...'],
    ['他说…', '他说…'],
    ['等一下……', '等一下……'],
    ['真的吗?!', '真的吗?!'],
    ['Wait...', 'Wait...'],
    ['hello!!', 'hello!!'],
    ['真的。。', '真的。。']
  ])('treats the run in %j atomically', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('leaves a preserved ellipsis without reporting a rule', () => {
    expect(postprocess('他说……')).toEqual({ text: '他说……', applied: [] })
    expect(postprocess('真的吗?!')).toEqual({ text: '真的吗?!', applied: [] })
  })

  it('still lets a filler consume an ellipsis run', () => {
    expect(clean('um... hello')).toBe('Hello')
    expect(clean('嗯……我们走吧。')).toBe('我们走吧。')
  })
})

describe('postprocess: purity', () => {
  it('has no Electron, DOM, filesystem, or network imports', () => {
    const dir = path.resolve(process.cwd(), 'src/core/postprocess')
    const files = readdirSync(dir).filter((file) => file.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), 'utf8')
      expect(source, file).not.toMatch(
        /\bfrom\s+['"](?:electron|node:fs|node:path|node:os|node:child_process)['"]/
      )
      expect(source, file).not.toMatch(/\b(?:document|window)\./)
      expect(source, file).not.toMatch(/\bfetch\s*\(/)
    }
  })
})

describe('postprocess: personal vocabulary', () => {
  it('replaces wrong spellings before normalisation', () => {
    expect(
      clean('用库贝内特斯部署。', {
        vocabulary: { replace: [{ from: '库贝内特斯', to: 'Kubernetes' }] }
      })
    ).toBe('用Kubernetes部署。')
  })

  it('respects ASCII word boundaries and case-insensitive matching', () => {
    const vocabulary = { replace: [{ from: 'cat', to: 'dog' }] }
    expect(clean('concatenate the cat', { vocabulary })).toBe('concatenate the dog')
    expect(
      clean('KUBERNETES is ready', {
        vocabulary: { replace: [{ from: 'kubernetes', to: 'Kubernetes' }] }
      })
    ).toBe('Kubernetes is ready')
  })

  it('never edits a protected token, even when a replacement matches it', () => {
    const vocabulary = {
      replace: [{ from: 'like', to: 'love' }],
      protect: ['like']
    }
    expect(clean('like', { vocabulary })).toBe('like')
  })

  it('protects tokens while other rules still run', () => {
    expect(
      clean('嗯，JustSpeak 很好用。', {
        vocabulary: { protect: ['JustSpeak'] }
      })
    ).toBe('JustSpeak 很好用。')
  })

  it('can be disabled without disabling protection', () => {
    const vocabulary = { replace: [{ from: 'cat', to: 'dog' }], protect: ['cat'] }
    expect(clean('cat', { vocabulary, rules: { vocabulary: false } })).toBe('cat')
  })
})

describe('postprocess: rule isolation', () => {
  function only(rule: PostprocessRule): RuleSwitches {
    return {
      vocabulary: rule === 'vocabulary',
      normalize: rule === 'normalize',
      'self-correction': rule === 'self-correction',
      filler: rule === 'filler',
      repetition: rule === 'repetition',
      casing: rule === 'casing'
    }
  }

  const cases: Array<[PostprocessRule, string, string]> = [
    ['normalize', '你好,世界!', '你好，世界！'],
    ['self-correction', '周一发，不对，周二发。', '周二发。'],
    ['filler', '嗯，我觉得可以。', '我觉得可以。'],
    ['repetition', '我我我觉得可以。', '我觉得可以。'],
    ['vocabulary', '库贝内特斯', 'Kubernetes']
  ]

  it.each(cases)('%s works with every other rule off', (rule, input, expected) => {
    const vocabulary =
      rule === 'vocabulary'
        ? { replace: [{ from: '库贝内特斯', to: 'Kubernetes' }] }
        : undefined
    expect(clean(input, { rules: only(rule), vocabulary })).toBe(expected)
  })

  it('normalisation can be disabled', () => {
    expect(clean('你好,世界!', { rules: { normalize: false } })).toBe('你好,世界!')
  })

  it('every rule is on by default and can be turned off explicitly', () => {
    const allOff = {
      rules: {
        vocabulary: false,
        normalize: false,
        'self-correction': false,
        filler: false,
        repetition: false,
        casing: false
      }
    }
    const input = ' 嗯，我我我 不对，the the 你好,世界! '
    expect(clean(input, allOff)).toBe(input)
  })
})

describe('postprocess: sentence-initial casing', () => {
  it.each([
    ['You know, it is fine.', 'It is fine.'],
    ['um, we should go', 'We should go'],
    ['I mean, tuesday.', 'Tuesday.'],
    ['嗯，我们开始吧。', '我们开始吧。']
  ])('restores the dropped capital in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('does not capitalise a word left mid-sentence', () => {
    expect(clean('I think, um, we should ship it.')).toBe('I think we should ship it.')
    expect(clean('We test, um, we ship.')).toBe('We test we ship.')
    expect(clean('I like it.')).toBe('I like it.')
  })

  it('reports the casing rule when it fires', () => {
    expectCase('You know, it is fine.', 'It is fine.', ['filler', 'casing'])
    expect(postprocess('I like it.')).toEqual({ text: 'I like it.', applied: [] })
  })

  it('never capitalises a protected token', () => {
    expect(
      postprocess('you know, iPhone is good.', { vocabulary: { protect: ['iPhone'] } })
    ).toEqual({ text: 'iPhone is good.', applied: ['filler'] })
    expect(clean('iPhone is great.', { vocabulary: { protect: ['iPhone'] } })).toBe(
      'iPhone is great.'
    )
  })

  it('never capitalises inside a code span or URL', () => {
    expect(clean('um, `foo` is good.')).toBe('`foo` is good.')
    expect(clean('um, https://example.com is down.')).toBe('https://example.com is down.')
  })

  it('only fires after a leading removal', () => {
    expect(postprocess('hello, world')).toEqual({ text: 'hello, world', applied: [] })
    expect(postprocess('her umbrella')).toEqual({ text: 'her umbrella', applied: [] })
    expect(postprocess('the the plan')).toEqual({ text: 'the plan', applied: ['repetition'] })
    expect(
      clean('concatenate the cat', { vocabulary: { replace: [{ from: 'cat', to: 'dog' }] } })
    ).toBe('concatenate the dog')
  })

  it.each([
    ['pnpm test', 'pnpm test'],
    ['npm run build', 'npm run build'],
    ['git commit', 'git commit'],
    ['um, pnpm test', 'pnpm test'],
    ['um, npm run build', 'npm run build']
  ])('keeps a bare command byte-for-byte in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('only fires after a leading removal when tested alone', () => {
    const rules: RuleSwitches = {
      vocabulary: false,
      normalize: false,
      'self-correction': false,
      filler: true,
      repetition: false,
      casing: true
    }
    expect(clean('You know, it is fine.', { rules })).toBe('It is fine.')
    expect(clean('You know, it is fine.', { rules: { ...rules, casing: false } })).toBe(
      'it is fine.'
    )
    expect(clean('hello, world', { rules })).toBe('hello, world')
  })

  it.each([
    ['Um. We should go.', 'We should go.'],
    ['You know. It is fine.', 'It is fine.'],
    ['um... hello', 'Hello'],
    ['um.... hello', 'Hello'],
    ['um?? hello', 'Hello'],
    ['um...', 'um...'],
    ['um?!', 'um?!'],
    ['嗯……我们走吧。', '我们走吧。'],
    ['We should go. Um.', 'We should go.'],
    ['We should go. Um...', 'We should go.'],
    ['We go um.', 'We go.'],
    ['We go um...', 'We go.'],
    ['We should go. Um. More.', 'We should go. More.'],
    ['I went um. Then home.', 'I went. Then home.'],
    ['I went um. Then home. And more.', 'I went. Then home. And more.'],
    ['We go um...Then home.', 'We go. Then home.'],
    ['We go um?! Then home.', 'We go? Then home.']
  ])('drops the whole orphan separator run in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('keeps the tail after a sentence-final filler with a protected term', () => {
    expect(
      clean('I went um. Then JustSpeak shipped.', { vocabulary: { protect: ['JustSpeak'] } })
    ).toBe('I went. Then JustSpeak shipped.')
  })

  it('can be disabled', () => {
    expect(clean('you know, it is fine.', { rules: { casing: false } })).toBe('it is fine.')
  })
})

describe('postprocess: masking layers', () => {
  const PROTECT = { vocabulary: { protect: ['JustSpeak'] } }

  it.each([
    'JustSpeak v1.2.3 is out.',
    'Mail JustSpeak at dev@example.com.',
    'See JustSpeak at https://example.com/JustSpeak tomorrow.'
  ])('never lets one layer rewrite another in %j', (input) => {
    const result = postprocess(input, PROTECT)
    expect(result).toEqual({ text: input, applied: [] })
    for (const sentinel of MASK_SENTINELS) expect(result.text).not.toContain(sentinel)
  })

  it('keeps multiple protect and code spans independent', () => {
    const input = 'JustSpeak v1.2.3 and FD2008 v2.0.1 are out.'
    const result = postprocess(input, {
      vocabulary: { protect: ['JustSpeak', 'FD2008'], replace: [{ from: 'cat', to: 'dog' }] }
    })
    expect(result).toEqual({ text: input, applied: [] })
    for (const sentinel of MASK_SENTINELS) expect(result.text).not.toContain(sentinel)
  })

  it('never lets a numeric replacement edit mask encoding', () => {
    // The plain `1` must be replaced, proving vocabulary ran; the protected
    // names and the mask ids must survive. A guard-only fallback would leave
    // the plain `1` untouched and fail this assertion.
    const input = 'JustSpeak 和 FD2008 都在，第 1 版。'
    const result = postprocess(input, {
      vocabulary: {
        protect: ['JustSpeak', 'FD2008'],
        replace: [{ from: '1', to: '一' }]
      }
    })
    expect(result).toEqual({
      text: 'JustSpeak 和 FD2008 都在，第 一 版。',
      applied: ['vocabulary']
    })
    for (const sentinel of MASK_SENTINELS) expect(result.text).not.toContain(sentinel)
  })

  it('masks with provably disjoint namespaces', () => {
    const outer = maskSpans('AAA bbb', [{ start: 0, end: 3 }], 'protect')
    const bStart = outer.masked.indexOf('bbb')
    const inner = maskSpans(outer.masked, [{ start: bStart, end: bStart + 3 }], 'code')
    expect(inner.masked[bStart]).not.toBe(outer.masked[0])
    // Restoring the code layer leaves the protect placeholder intact.
    expect(inner.restore(inner.masked)).toBe(outer.masked)
    expect(outer.restore(inner.restore(inner.masked))).toBe('AAA bbb')
  })

  it('fails closed when a sentinel would leak', () => {
    const sentinel = (layer: 'protect' | 'code'): string => {
      const [start, end] = layer === 'protect' ? [0xe000, 0xe001] : [0xe002, 0xe003]
      return `x${String.fromCharCode(start)}0${String.fromCharCode(end)}y`
    }
    const protectSentinel = sentinel('protect')
    const codeSentinel = sentinel('code')
    // Guard the guard: the inputs really do contain the sentinel characters.
    for (const input of [protectSentinel, codeSentinel]) {
      expect(MASK_SENTINELS.some((marker) => input.includes(marker))).toBe(true)
      expect(postprocess(input)).toEqual({ text: input, applied: [] })
    }
  })

  it('fails closed when a rule would otherwise change a sentinel-bearing text', () => {
    // The filler would remove `um,`; the guard must still return the original.
    const input = `um, hello ${String.fromCharCode(0xe000)}0${String.fromCharCode(0xe001)}`
    expect(postprocess(input)).toEqual({ text: input, applied: [] })
  })

  it('does not restore sentinel-shaped text it did not emit', () => {
    const userSentinel = `${String.fromCharCode(0xe002)}0${String.fromCharCode(0xe003)}`
    const input = `use \`pnpm test\` then ${userSentinel}`
    const result = postprocess(input)
    expect(result).toEqual({ text: input, applied: [] })
    // The old shared-restore bug duplicated the code span here instead.
    expect(result.text).not.toBe('use `pnpm test` then `pnpm test`')
  })

  it('returns identical output across calls', () => {
    const input = 'um, JustSpeak v1.2.3 and `pnpm test`'
    const options = { vocabulary: { protect: ['JustSpeak'] } }
    expect(postprocess(input, options)).toEqual(postprocess(input, options))
  })

  it('does not let vocabulary rewrite code-like tokens', () => {
    const vocabulary = { replace: [{ from: 'cat', to: 'dog' }] }
    expect(clean('`cat` and cat', { vocabulary })).toBe('`cat` and dog')
    expect(clean('https://example.com/cat', { vocabulary })).toBe('https://example.com/cat')
  })

  it('stays bounded on a long token', () => {
    const input = 'a.'.repeat(30_000)
    const started = performance.now()
    const result = postprocess(input)
    const elapsed = performance.now() - started
    expect(result.text.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1000)
  })
})

describe('postprocess: safety and pass-through', () => {
  it('turns filler-only input into the original instead of empty text', () => {
    const input = '嗯，呃，啊'
    expect(postprocess(input)).toEqual({ text: input, applied: [] })
  })

  it('never returns empty for a non-empty input', () => {
    for (const input of ['嗯', '嗯，', 'um', 'Uh,', '   ', '\n\t']) {
      const result = postprocess(input)
      expect(result.text).not.toBe('')
      expect(result.text).toBe(input)
      expect(result.applied).toEqual([])
    }
  })

  it('returns empty and no rules for empty input', () => {
    expect(postprocess('')).toEqual({ text: '', applied: [] })
  })

  it('leaves plain prose unchanged', () => {
    const prose = [
      '今天天气很好，我们去公园散步。',
      'The quick brown fox jumps over the lazy dog.',
      '我喜欢 JustSpeak，它很好用。',
      'Please send the report on Tuesday, before the meeting.'
    ]
    for (const input of prose) expect(postprocess(input)).toEqual({ text: input, applied: [] })
  })

  it('handles mixed Chinese and English without translating anything', () => {
    expect(clean('嗯，我明天用 Kubernetes 部署 the the 服务。')).toBe(
      '我明天用 Kubernetes 部署 the 服务。'
    )
  })
})
