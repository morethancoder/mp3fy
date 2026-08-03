// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		mtui: {
			toast: (
				message: string,
				opts?: {
					kind?: 'tick' | 'success' | 'error';
					action?: { label: string; onClick: () => void };
				}
			) => void;
			feedback: {
				muted: boolean;
				play: (cue: string) => void;
			};
		};
	}
}

export {};
