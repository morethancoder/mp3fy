/**
 * Sound cues.
 *
 * MTUI's js/feedback.js owns the five UI cues and one persisted mute switch,
 * and `data-feedback` on a button fires `success` by default — which meant
 * pressing "Get audio" and the download actually landing sounded identical.
 * Buttons in this app therefore opt into `tick` (a single dry blip), and a
 * finished job gets `chime()`: a four-note arpeggio no tap can produce.
 *
 * Same AudioContext discipline as MTUI's cues — lazy, resumed on demand,
 * silent when the shared mute is on and when there is no WebAudio at all.
 */

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
	if (ctx) return ctx;
	const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	ctx = Ctor ? new Ctor() : null;
	return ctx;
}

/** The user's one mute switch lives in MTUI — never a second one here. */
export function muted(): boolean {
	return window.mtui?.feedback?.muted ?? false;
}

/** Play one of MTUI's own cues by name. */
export function cue(name: 'tick' | 'toggle-on' | 'toggle-off' | 'success' | 'error'): void {
	window.mtui?.feedback?.play(name);
}

/**
 * The "your file is ready" sound: a C-major arpeggio, each note plucked and
 * decaying into the next. Deliberately longer and richer than any cue a
 * button can fire, so completion is recognisable without looking.
 */
export function chime(): void {
	if (muted()) return;
	const c = audioCtx();
	if (!c) return;
	if (c.state === 'suspended') void c.resume().catch(() => {});

	const t0 = c.currentTime + 0.01;
	const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
	const gap = 0.075;
	const ring = 0.5;

	// One shared lowpass keeps the stack soft rather than glassy, and one
	// shared gain node caps the sum of four overlapping notes at MTUI's
	// 0.06 ceiling — four voices at the per-cue peak would be four times
	// as loud as anything else the app plays.
	const lp = c.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.setValueAtTime(4000, t0);
	lp.Q.setValueAtTime(0.7, t0);

	const master = c.createGain();
	master.gain.setValueAtTime(0.055, t0);
	lp.connect(master).connect(c.destination);

	notes.forEach((freq, i) => {
		const at = t0 + i * gap;
		const osc = c.createOscillator();
		const gain = c.createGain();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(freq, at);
		// Click-free attack, then an exponential decay — no sustain plateau.
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(0.4, at + 0.008);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
		gain.gain.setValueAtTime(0, at + ring + 0.01);
		osc.connect(gain).connect(lp);
		osc.start(at);
		osc.stop(at + ring + 0.02);
		osc.addEventListener('ended', () => {
			osc.disconnect();
			gain.disconnect();
		});
	});

	if (typeof navigator.vibrate === 'function') {
		try {
			navigator.vibrate([12, 40, 12]);
		} catch {
			// unsupported in this context — the tone already carried the news
		}
	}
}
