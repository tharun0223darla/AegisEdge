/**
 * Web Audio API synthesizer for RPM Emergency Siren, Wrong-Pill Warning Buzzer, and Success Chimes.
 * Plays natively through laptop / device speakers on localhost with zero external MP3 dependencies.
 */

let audioCtx: AudioContext | null = null;
let sirenOscillator: OscillatorNode | null = null;
let sirenGainNode: GainNode | null = null;
let sirenTimer: any = null;

function getAudioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch (e) {
    console.warn('Web Audio API not supported or blocked by browser policy:', e);
    return null;
  }
}

/**
 * Plays a loud, alternating dual-tone emergency ambulance / hospital siren (e.g. 700Hz <-> 960Hz).
 */
export function playEmergencySiren() {
  stopAllAudio();
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(700, ctx.currentTime);

    gain.gain.setValueAtTime(0.18, ctx.currentTime); // Safe audible volume

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    sirenOscillator = osc;
    sirenGainNode = gain;

    let isHigh = false;
    sirenTimer = setInterval(() => {
      if (sirenOscillator && audioCtx && audioCtx.state === 'running') {
        const nextFreq = isHigh ? 700 : 960;
        sirenOscillator.frequency.setTargetAtTime(nextFreq, audioCtx.currentTime, 0.08);
        isHigh = !isHigh;
      }
    }, 500);
  } catch (e) {
    console.warn('Failed to start emergency siren audio:', e);
  }
}

/**
 * Plays a sharp, loud double-buzz warning sound when a wrong medicine is intercepted.
 */
export function playWrongPillBuzzer() {
  stopAllAudio();
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, ctx.currentTime); // Low aggressive buzzer pitch

    // Double pulse pattern
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.setValueAtTime(0.01, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.25, ctx.currentTime + 0.26);
    gain.gain.setValueAtTime(0.001, ctx.currentTime + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.warn('Failed to play buzzer sound:', e);
  }
}

/**
 * Plays a pleasant ascending two-tone chime when a medicine strip matches successfully.
 */
export function playSuccessChime() {
  stopAllAudio();
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(659.25, now + 0.12); // E5
    osc.frequency.setValueAtTime(783.99, now + 0.24); // G5

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  } catch (e) {
    console.warn('Failed to play success chime:', e);
  }
}

/**
 * Stops all currently playing sirens or oscillators.
 */
export function stopAllAudio() {
  if (sirenTimer) {
    clearInterval(sirenTimer);
    sirenTimer = null;
  }
  if (sirenOscillator) {
    try {
      sirenOscillator.stop();
      sirenOscillator.disconnect();
    } catch {}
    sirenOscillator = null;
  }
  if (sirenGainNode) {
    try {
      sirenGainNode.disconnect();
    } catch {}
    sirenGainNode = null;
  }
}
