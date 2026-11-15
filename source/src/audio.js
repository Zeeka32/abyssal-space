// Fictional onboard audio: tonal reactor hum, ion-drive harmonics and warp charge.
// Every source is an oscillator. There are no noise buffers or wind/rush layers.
let AC, OUT, muted = false;
const VOL = .52, AUDIO_STATE = { drive: 0, boost: false };
function mkSound(ac) {
  rseed(99);
  const N = (C, options, ...to) => { const n = new C(ac, options); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const limit = N(DynamicsCompressorNode, { threshold: -8, knee: 8, ratio: 12, attack: .005, release: .4 }, ac.destination);
  const out = OUT = G(muted ? 0 : VOL, limit);
  const delay = N(DelayNode, { maxDelayTime: 2, delayTime: .59 }, G(.18, out));
  delay.connect(G(.30, delay));
  // The idle reactor is pitched, with slow beating rather than broadband rumble.
  const reactor = G(.045, out);
  N(OscillatorNode, { frequency: 36, type: 'sine' }, reactor);
  N(OscillatorNode, { frequency: 36.16, type: 'sine' }, reactor);
  const engine = G(0, out), engineTone = N(BiquadFilterNode, { type: 'lowpass', frequency: 520, Q: .6 }, engine);
  const carrier = N(OscillatorNode, { type: 'triangle', frequency: 48 }, engineTone);
  const harmonic = N(OscillatorNode, { type: 'sine', frequency: 96.2 }, G(.34, engineTone));
  const fmDepth = G(0, carrier.frequency), modulator = N(OscillatorNode, { frequency: 8, type: 'sine' }, fmDepth);
  const warpGain = G(0, out, delay), warp = N(OscillatorNode, { type: 'sine', frequency: 140 }, warpGain);
  const chargeGain = G(0, out, delay), charge = N(OscillatorNode, { type: 'sine', frequency: 70 }, chargeGain);
  const pad = G(.65, out, delay);
  for (const f of [55, 82.407, 110, 164.814, 220]) {
    const g = G(.026, pad);
    N(OscillatorNode, { frequency: f }, g); N(OscillatorNode, { frequency: f + .07 }, g);
    N(OscillatorNode, { frequency: rr(.025, .07) }, G(.009, g.gain));
  }
  const voices = Array.from({ length: 4 }, () => {
    const pan = N(StereoPannerNode, {}, out, delay), envelope = G(0, pan);
    return { oscillator: N(OscillatorNode, { type: 'sine', frequency: 440 }, envelope), envelope, pan };
  });
  const notes = [220, 293.665, 329.628, 440, 587.33, 659.255];
  let next = ac.currentTime + 2, voice = 0, wasBoost = false;
  return () => {
    const now = ac.currentTime;
    // Use flight velocity, so orbit tracking and destination jumps never fire the drive.
    const speed = menu ? 0 : min(240, hypot(F[VX], F[VY], F[VZ]));
    const drive = clamp(speed / 65, 0, 1), boost = !menu && (ks || tN > 1) && speed > 15;
    AUDIO_STATE.drive = drive; AUDIO_STATE.boost = !!boost;
    engine.gain.setTargetAtTime(drive * (boost ? .12 : .085), now, .15);
    carrier.frequency.setTargetAtTime(44 + drive * 28 + (boost ? 48 : 0), now, .20);
    harmonic.frequency.setTargetAtTime(88.2 + drive * 56 + (boost ? 96 : 0), now, .20);
    modulator.frequency.setTargetAtTime(boost ? 22 : 8, now, .18);
    fmDepth.gain.setTargetAtTime(boost ? 28 : drive * 4, now, .18);
    engineTone.frequency.setTargetAtTime(boost ? 760 : 380, now, .18);
    warp.frequency.setTargetAtTime(140 + speed * .45, now, .25);
    warpGain.gain.setTargetAtTime(boost ? .042 : 0, now, .18);
    if (boost && !wasBoost) {
      charge.frequency.cancelScheduledValues(now);
      charge.frequency.setValueAtTime(70, now); charge.frequency.exponentialRampToValueAtTime(420, now + .65);
      chargeGain.gain.cancelScheduledValues(now);
      chargeGain.gain.setValueAtTime(0, now); chargeGain.gain.linearRampToValueAtTime(.09, now + .07);
      chargeGain.gain.exponentialRampToValueAtTime(.0001, now + .85);
    }
    if (!boost && wasBoost) { chargeGain.gain.cancelScheduledValues(now); chargeGain.gain.setTargetAtTime(0, now, .08); }
    wasBoost = !!boost;
    if (now > next) {
      const v = voices[voice++ % voices.length], f = notes[rnd() * notes.length | 0];
      v.pan.pan.setValueAtTime(rr(-.65, .65), now); v.oscillator.frequency.setValueAtTime(f, now);
      v.envelope.gain.cancelScheduledValues(now); v.envelope.gain.setValueAtTime(0, now);
      v.envelope.gain.linearRampToValueAtTime(.035, now + .04);
      v.envelope.gain.exponentialRampToValueAtTime(.0001, now + 3.5); next = now + rr(3.5, 9);
    }
  };
}
function sound() {
  if (!AC) {
    try { AC = launchAudio || new AudioContext({ latencyHint: 'playback' }); setInterval(mkSound(AC), 100); }
    catch (error) { console.warn('Audio unavailable:', error); return; }
  }
  if (AC.state === 'suspended' && !document.hidden) AC.resume().catch(() => {});
}
function mute() {
  muted = !muted;
  if (AC && OUT) OUT.gain.setTargetAtTime(muted ? 0 : VOL, AC.currentTime, .1);
}
document.addEventListener('visibilitychange', () => { if (AC) (document.hidden ? AC.suspend() : AC.resume()).catch(() => {}); });
sound();
if (!mob) capture();
