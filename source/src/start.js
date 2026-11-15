// First-click gate. No GPU requests, world generation, audio graph or animation loop before this resolves.
let launchAudio;
const initialQualityButtons = document.querySelectorAll('#q button');
const showInitialQuality = () => initialQualityButtons.forEach((b, i) => {
  b.classList.toggle('on', i === 2 - LV); b.setAttribute('aria-pressed', i === 2 - LV);
});
initialQualityButtons.forEach((b, i) => { b.onclick = () => { LV = 2 - i; SV = [LV]; keep('astral', LV); showInitialQuality(); }; });
showInitialQuality();
await new Promise(resolve => {
  const button = document.getElementById('d');
  button.onclick = () => {
    button.onclick = null;
    document.body.className = 'l'; document.body.dataset.stage = 'building';
    // Reserve/resume the context during the trusted click; build its sources after generation.
    try { launchAudio = new AudioContext({ latencyHint: 'playback' }); launchAudio.resume().catch(() => {}); } catch {}
    if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => {});
    resolve();
  };
  button.focus();
});
const AA = LV > 1 ? 1 : 4;
