type PlatformObservabilityOptions = {
	appId: string;
	environment?: string;
};

let initialized = false;

function emitTelemetry(
	name: string,
	attributes: Record<string, unknown>,
): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(
		new CustomEvent('platform:telemetry', {
			detail: {
				name,
				at: new Date().toISOString(),
				attributes,
			},
		}),
	);
}

export function initPlatformObservability(
	options: PlatformObservabilityOptions,
): void {
	if (initialized || typeof window === 'undefined') return;
	initialized = true;

	const environment =
		options.environment ||
		(typeof import.meta !== 'undefined'
			? (
					import.meta as ImportMeta & {
						env?: Record<string, string | undefined>;
					}
				).env?.MODE
			: 'unknown') ||
		'unknown';

	// Baseline tags for Sentry/OpenTelemetry correlation.
	emitTelemetry('observability.init', {
		appId: options.appId,
		environment,
		stack: 'Sentry/OpenTelemetry-ready',
	});

	if (typeof window.addEventListener === 'function') {
		window.addEventListener('error', (event) => {
			emitTelemetry('frontend.error', {
				appId: options.appId,
				message: event.message,
				source: event.filename || 'unknown',
				line: event.lineno || 0,
			});
		});

		window.addEventListener('unhandledrejection', (event) => {
			const reason =
				event.reason instanceof Error
					? event.reason.message
					: String(event.reason ?? 'unknown');
			emitTelemetry('frontend.unhandledrejection', {
				appId: options.appId,
				reason,
			});
		});
	}

	if (typeof PerformanceObserver === 'undefined') return;

	const supportsBuffered = (type: string) => {
		try {
			return PerformanceObserver.supportedEntryTypes.includes(type);
		} catch {
			return false;
		}
	};

	// Web Vitals baseline (LCP / CLS / INP approximation).
	if (supportsBuffered('largest-contentful-paint')) {
		const lcpObserver = new PerformanceObserver((entryList) => {
			const entries = entryList.getEntries();
			const last = entries[entries.length - 1];
			if (!last) return;
			emitTelemetry('web-vitals.lcp', {
				appId: options.appId,
				value: Math.round(last.startTime),
			});
		});
		lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
	}

	if (supportsBuffered('layout-shift')) {
		let cls = 0;
		const clsObserver = new PerformanceObserver((entryList) => {
			for (const entry of entryList.getEntries() as Array<
				PerformanceEntry & { value?: number; hadRecentInput?: boolean }
			>) {
				if (!entry.hadRecentInput) {
					cls += entry.value || 0;
				}
			}
			emitTelemetry('web-vitals.cls', {
				appId: options.appId,
				value: Number(cls.toFixed(4)),
			});
		});
		clsObserver.observe({ type: 'layout-shift', buffered: true });
	}

	if (supportsBuffered('first-input')) {
		const fidObserver = new PerformanceObserver((entryList) => {
			const entries = entryList.getEntries();
			const first = entries[0] as PerformanceEntry & {
				processingStart?: number;
			};
			if (!first || typeof first.processingStart !== 'number') return;
			emitTelemetry('web-vitals.fid', {
				appId: options.appId,
				value: Math.round(first.processingStart - first.startTime),
			});
		});
		fidObserver.observe({ type: 'first-input', buffered: true });
	}
}
