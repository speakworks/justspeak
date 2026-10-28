import { describe, expect, it } from 'vitest'
import {
  postprocess,
  type PostprocessOptions,
  type PostprocessRule,
  type RuleSwitches
} from '../src/core/postprocess'

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
    ['  hello   world  ', 'Hello world'],
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
    ['her umbrella', 'Her umbrella'],
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
    ['the the plan is ready.', 'The plan is ready.'],
    ['The The plan is ready.', 'The plan is ready.'],
    ['hello!!', 'Hello!'],
    ['真的。。', '真的。']
  ])('collapses repeats in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it.each([
    ['谢谢你的帮助。', '谢谢你的帮助。'],
    ['妈妈和爸爸来了。', '妈妈和爸爸来了。'],
    ['哈哈哈', '哈哈哈'],
    ['I had had enough.', 'I had had enough.'],
    ['Wait...', 'Wait...']
  ])('keeps legitimate repetition in %j', (input, expected) => {
    expect(clean(input)).toBe(expected)
  })

  it('honours the configurable threshold', () => {
    expect(clean('我我走了。', { repetitionThreshold: 3 })).toBe('我我走了。')
    expect(clean('我我我走了。', { repetitionThreshold: 3 })).toBe('我走了。')
    expect(clean('the the the plan', { repetitionThreshold: 3 })).toBe('The plan')
  })

  it('is individually disableable', () => {
    expect(clean('我我我觉得可以。', { rules: { repetition: false } })).toBe('我我我觉得可以。')
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
    expect(clean('concatenate the cat', { vocabulary })).toBe('Concatenate the dog')
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
    ['vocabulary', '库贝内特斯', 'Kubernetes'],
    ['casing', 'it is fine.', 'It is fine.']
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
    expect(clean('you know, iPhone is good.', { vocabulary: { protect: ['iPhone'] } })).toBe(
      'iPhone is good.'
    )
    expect(clean('iPhone is great.', { vocabulary: { protect: ['iPhone'] } })).toBe(
      'iPhone is great.'
    )
  })

  it('never capitalises inside a code span or URL', () => {
    expect(clean('`foo` is good.')).toBe('`foo` is good.')
    expect(clean('https://example.com is down.')).toBe('https://example.com is down.')
  })

  it('can be disabled', () => {
    expect(clean('you know, it is fine.', { rules: { casing: false } })).toBe('it is fine.')
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
