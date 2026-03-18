import {
	type Attributes,
	type Context,
	context,
	createContextKey,
	isSpanContextValid,
	propagation,
	type Span,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

const tracer = trace.getTracer('servicenova-ai');
const fallbackTraceIdKey = createContextKey('servicenova.fallback.trace_id');
const fallbackSpanIdKey = createContextKey('servicenova.fallback.span_id');
let contextManagerInitialized = false;

function ensureContextManager() {
	if (contextManagerInitialized) {
		return;
	}

	try {
		contextManagerInitialized = context.setGlobalContextManager(
			new AsyncLocalStorageContextManager(),
		);
	} catch {
		// Continue even if registration cannot happen in this runtime.
		contextManagerInitialized = true;
	}
}

function randomHex(length: number) {
	const byteLength = Math.ceil(length / 2);
	const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, length);
}

function toHeaderCarrier(
	headers?: HeadersInit | Record<string, string | undefined> | null,
) {
	const carrier: Record<string, string> = {};

	if (!headers) {
		return carrier;
	}

	if (headers instanceof Headers) {
		for (const [key, value] of headers.entries()) {
			carrier[key] = value;
		}
		return carrier;
	}

	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			carrier[key] = value;
		}
		return carrier;
	}

	for (const [key, value] of Object.entries(headers)) {
		if (value !== undefined) {
			carrier[key] = value;
		}
	}
	return carrier;
}

function spanContextOrNull() {
	const active = trace.getActiveSpan();
	const spanContext = active?.spanContext();
	if (!spanContext || !isSpanContextValid(spanContext)) {
		return null;
	}

	return spanContext;
}

export function currentTraceId() {
	ensureContextManager();
	const fromSpan = spanContextOrNull()?.traceId;
	if (fromSpan) {
		return fromSpan;
	}
	const fromFallback = context.active().getValue(fallbackTraceIdKey);
	return typeof fromFallback === 'string' ? fromFallback : null;
}

export function currentTraceparent() {
	ensureContextManager();
	const spanContext = spanContextOrNull();
	if (spanContext) {
		const flagsHex = spanContext.traceFlags.toString(16).padStart(2, '0');
		return `00-${spanContext.traceId}-${spanContext.spanId}-${flagsHex}`;
	}

	const traceId = currentTraceId();
	const fallbackSpanId = context.active().getValue(fallbackSpanIdKey);
	if (!traceId || typeof fallbackSpanId !== 'string') {
		return null;
	}
	return `00-${traceId}-${fallbackSpanId}-01`;
}

export function withExtractedTraceContext<T>(
	headers: Record<string, string | undefined>,
	fn: () => Promise<T> | T,
) {
	ensureContextManager();
	const extracted = propagation.extract(
		context.active(),
		toHeaderCarrier(headers),
	);
	return context.with(extracted, fn);
}

export function withContext<T>(ctx: Context, fn: () => Promise<T> | T) {
	ensureContextManager();
	return context.with(ctx, fn);
}

export function injectTraceHeaders(
	headers?: HeadersInit | Record<string, string | undefined> | null,
) {
	ensureContextManager();
	const carrier = toHeaderCarrier(headers);
	propagation.inject(context.active(), carrier);
	if (!carrier.traceparent) {
		const traceparent = currentTraceparent();
		if (traceparent) {
			carrier.traceparent = traceparent;
		}
	}
	return carrier;
}

export async function withSpan<T>(
	name: string,
	attributes: Attributes,
	fn: (span: Span) => Promise<T> | T,
) {
	ensureContextManager();
	return tracer.startActiveSpan(name, { attributes }, async (span) => {
		const spanContext = span.spanContext();
		const fallbackContext = isSpanContextValid(spanContext)
			? context.active()
			: context
					.active()
					.setValue(fallbackTraceIdKey, randomHex(32))
					.setValue(fallbackSpanIdKey, randomHex(16));
		try {
			return await withContext(fallbackContext, async () => fn(span));
		} catch (error) {
			span.recordException(error as Error);
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			span.end();
		}
	});
}
