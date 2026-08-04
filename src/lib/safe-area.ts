/**
 * The edges of the screen the app must not paint into.
 *
 * CSS has an answer for this — `env(safe-area-inset-*)`, which MTUI's shell
 * already uses on the header and the tab bar — and on Android WebView that
 * answer is wrong. There, the env() values describe the *display cutout* and
 * nothing else: the status bar and the gesture bar are invisible to CSS. The
 * Android build draws edge to edge (MainActivity calls `enableEdgeToEdge`, and
 * from targetSdk 35 the system does it anyway), so with only env() to go on
 * the header sat under the clock and the player's close button under the
 * notch.
 *
 * So the real insets are read from the window itself and published as CSS
 * custom properties, which app.css folds in with `max(env(…), var(…))` — the
 * larger of what CSS knows and what the window says. Everywhere else the
 * command answers zero and env() keeps doing the work, which is why nothing
 * here is Android-specific except the numbers.
 */

import { isTauri, safeAreaInsets } from './api';

const VARS = ['top', 'bottom', 'left', 'right'] as const;

async function apply(): Promise<void> {
	if (!isTauri) return;
	try {
		const insets = await safeAreaInsets();
		for (const edge of VARS) {
			const value = insets[edge];
			// Only ever raise the floor: writing 0px on a platform where env()
			// is the truthful source would undo it.
			document.documentElement.style.setProperty(
				`--safe-${edge}`,
				Number.isFinite(value) && value > 0 ? `${value}px` : '0px'
			);
		}
	} catch {
		// An older build without the command — env() alone, as before.
	}
}

/**
 * Publish the insets and keep them current. Rotating the phone, folding it
 * open, or the navigation bar changing mode all resize the webview, which is
 * the one signal every case shares.
 */
export function initSafeArea(): () => void {
	void apply();
	let queued = 0;
	const refresh = () => {
		clearTimeout(queued);
		// The webview resizes before Android settles the new insets; one frame
		// of delay is the difference between the old numbers and the new ones.
		queued = setTimeout(() => void apply(), 150) as unknown as number;
	};
	window.addEventListener('resize', refresh);
	window.addEventListener('orientationchange', refresh);
	return () => {
		clearTimeout(queued);
		window.removeEventListener('resize', refresh);
		window.removeEventListener('orientationchange', refresh);
	};
}
