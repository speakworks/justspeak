/**
 * TTS first-packet probe. Runs inside Electron (main process), not Node, because
 * speech output is only reachable through Chromium's `speechSynthesis`, which is
 * what the app would use as well.
 *
 *   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     scripts/latency-harness/tts-probe.cjs --samples 20 --text "..."
 *
 * Prints exactly one line: `HARNESS_RESULT {json}`. The caller owns the
 * interpretation; this file only reports what the engine did, including the
 * case where it did nothing.
 */
const { app, BrowserWindow } = require('electron')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const samples = Number(arg('samples', '20'))
const text = arg('text', '今天天气不错，我们下午三点开会。')
const gapMs = Number(arg('gap', '400'))

app.disableHardwareAcceleration()

const injected = `(async () => {
  const text = ${JSON.stringify(text)};
  const targetSamples = ${Number.isFinite(samples) && samples > 0 ? Math.round(samples) : 20};
  const gapMs = ${Number.isFinite(gapMs) && gapMs >= 0 ? Math.round(gapMs) : 400};
  const synth = window.speechSynthesis;
  await new Promise((resolve) => setTimeout(resolve, 300));
  const voices = synth.getVoices();
  const zhVoice = voices.find((voice) => /zh/i.test(voice.lang)) || null;
  const startMs = [];
  const boundaryMs = [];
  const errors = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < targetSamples; i += 1) {
    const outcome = await new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1;
      if (zhVoice) utterance.voice = zhVoice;
      const t0 = performance.now();
      let started = null;
      let firstBoundary = null;
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      };
      const timer = setTimeout(() => finish({ error: 'timeout' }), 15000);
      utterance.onstart = () => { started = performance.now() - t0; };
      utterance.onboundary = () => {
        if (firstBoundary === null) firstBoundary = performance.now() - t0;
      };
      utterance.onend = () => finish({ started, firstBoundary });
      utterance.onerror = (event) => finish({ error: (event && event.error) || 'error' });
      try {
        synth.speak(utterance);
      } catch (error) {
        finish({ error: 'speak-threw: ' + (error && error.message ? error.message : String(error)) });
      }
    });
    if (outcome.error) {
      errors.push(outcome.error);
      if (outcome.error === 'timeout') break;
    } else {
      if (outcome.started !== null) startMs.push(outcome.started);
      if (outcome.firstBoundary !== null) boundaryMs.push(outcome.firstBoundary);
    }
    await sleep(gapMs);
  }

  return {
    startMs,
    boundaryMs,
    errors,
    voiceCount: voices.length,
    zhVoice: zhVoice ? zhVoice.name : null,
    requestedSamples: targetSamples
  };
})()`

app.whenReady().then(async () => {
  let window
  try {
    window = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: { backgroundThrottling: false }
    })
    await window.loadURL('data:text/html,<html><body></body></html>')
    const result = await window.webContents.executeJavaScript(injected, true)
    process.stdout.write(`HARNESS_RESULT ${JSON.stringify(result)}\n`)
    app.exit(0)
  } catch (error) {
    process.stdout.write(
      `HARNESS_RESULT ${JSON.stringify({
        startMs: [],
        boundaryMs: [],
        errors: [`probe-failed: ${error instanceof Error ? error.message : String(error)}`],
        voiceCount: 0,
        zhVoice: null
      })}\n`
    )
    app.exit(1)
  }
})
