import type { JobPriority, ServiceJob } from '../field-ops/service';
import { currentTenantId } from '../field-ops/tenant-context';
import type { CrmCustomerRecord, InvoiceRecord } from './adapters';
import {
	configureIntegrationOutboxStore,
	enqueueCrmWorkOrderEvent,
	flushIntegrationOutbox,
	getIntegrationOutboxSummary,
	listIntegrationOutboxEntries,
	requeueIntegrationOutboxDeadLetters,
	resetIntegrationOutboxForTests,
} from './outbox';
import {
	getIntegrationAdapters,
	resetIntegrationsRuntimeForTests,
} from './runtime';

export type CustomerContext = CrmCustomerRecord;
export type Invoice = InvoiceRecord;

type WorkOrderEvent = {
	jobId: string;
	customerId: string;
	status: ServiceJob['status'];
	timestamp: string;
};

type IntegrationState = {
	customerContexts: Record<string, CustomerContext>;
	invoices: Invoice[];
	events: WorkOrderEvent[];
};

function initialState(): IntegrationState {
	return {
		customerContexts: {},
		invoices: [],
		events: [],
	};
}

const tenantStates = new Map<string, IntegrationState>();

function normalizeTenantId(value: string | null | undefined) {
	return value?.trim() || 'default';
}

function stateRef() {
	const tenantId = normalizeTenantId(currentTenantId());
	const existing = tenantStates.get(tenantId);

	if (existing) {
		return existing;
	}

	const created = initialState();
	tenantStates.set(tenantId, created);
	return created;
}

function priorityMultiplier(priority: JobPriority) {
	if (priority === 'urgent') {
		return 1.3;
	}

	if (priority === 'high') {
		return 1.15;
	}

	return 1;
}

function customerRatePerMinuteCents(customerTier: CustomerContext['tier']) {
	if (customerTier === 'enterprise') {
		return 240;
	}

	if (customerTier === 'priority') {
		return 220;
	}

	return 200;
}

function cents(value: number) {
	return Math.max(0, Math.round(value));
}

export async function getCustomerContext(
	customerId: string,
): Promise<CustomerContext | null> {
	const state = stateRef();
	const cached = state.customerContexts[customerId];

	if (cached) {
		return cached;
	}

	const adapters = getIntegrationAdapters();
	const remote = await adapters.crm.getCustomerContext(customerId);

	if (!remote) {
		return null;
	}

	state.customerContexts[customerId] = remote;
	return remote;
}

export async function syncCrmWorkOrderEvent(job: ServiceJob) {
	if (!job.customerId) {
		return { queued: false, outboxEntryId: null };
	}

	const state = stateRef();
	const event: WorkOrderEvent = {
		jobId: job.id,
		customerId: job.customerId,
		status: job.status,
		timestamp: new Date().toISOString(),
	};

	state.events.unshift(event);
	const outboxEntry = await enqueueCrmWorkOrderEvent(event);
	const cachedContext = state.customerContexts[job.customerId];

	if (cachedContext) {
		if (job.status === 'closed') {
			cachedContext.openServiceCount = Math.max(
				0,
				cachedContext.openServiceCount - 1,
			);
		}

		cachedContext.lastServiceAt = event.timestamp;
		state.customerContexts[job.customerId] = cachedContext;
	}

	return {
		queued: true,
		outboxEntryId: outboxEntry.id,
	};
}

export async function createInvoiceFromCompletedJob(input: {
	job: ServiceJob;
	taxRatePercent?: number;
	calloutFeeCents?: number;
}): Promise<{ ok: true; invoice: Invoice } | { ok: false; reason: string }> {
	if (!input.job.customerId) {
		return { ok: false, reason: 'Job has no customer mapping' };
	}

	if (input.job.status !== 'closed') {
		return { ok: false, reason: 'Job must be closed before invoice creation' };
	}

	const state = stateRef();
	const existing = state.invoices.find(
		(invoice) => invoice.jobId === input.job.id,
	);

	if (existing) {
		return { ok: true, invoice: existing };
	}

	const context = await getCustomerContext(input.job.customerId);

	if (!context) {
		return { ok: false, reason: 'Customer context not found in CRM' };
	}

	const labor = cents(
		input.job.estimatedMinutes *
			customerRatePerMinuteCents(context.tier) *
			priorityMultiplier(input.job.priority),
	);
	const callout = cents(input.calloutFeeCents ?? 4900);
	const subtotal = labor + callout;
	const taxCents = cents(subtotal * ((input.taxRatePercent ?? 8.25) / 100));

	const adapters = getIntegrationAdapters();
	const invoice = await adapters.invoicing.createInvoice({
		jobId: input.job.id,
		customerId: input.job.customerId,
		currency: 'USD',
		subtotalCents: subtotal,
		taxCents,
		totalCents: subtotal + taxCents,
		lineItems: [
			{ description: `Labor for ${input.job.title}`, amountCents: labor },
			{ description: 'Dispatch callout', amountCents: callout },
		],
	});

	state.invoices = [
		invoice,
		...state.invoices.filter((item) => item.id !== invoice.id),
	];
	return { ok: true, invoice };
}

export async function listInvoices() {
	const state = stateRef();
	const adapters = getIntegrationAdapters();
	const invoices = await adapters.invoicing.listInvoices();
	state.invoices = invoices;
	return state.invoices;
}

export async function getInvoice(invoiceId: string) {
	const state = stateRef();
	const cached = state.invoices.find((invoice) => invoice.id === invoiceId);

	if (cached) {
		return cached;
	}

	const adapters = getIntegrationAdapters();
	const invoice = await adapters.invoicing.getInvoice(invoiceId);

	if (!invoice) {
		return null;
	}

	state.invoices = [
		invoice,
		...state.invoices.filter((item) => item.id !== invoice.id),
	];
	return invoice;
}

export function listCrmWorkOrderEvents(limit = 100) {
	const state = stateRef();
	return state.events.slice(0, Math.max(1, Math.min(limit, 500)));
}

export {
	configureIntegrationOutboxStore,
	listIntegrationOutboxEntries,
	flushIntegrationOutbox,
	getIntegrationOutboxSummary,
	requeueIntegrationOutboxDeadLetters,
};

export async function resetIntegrationStateForTests() {
	tenantStates.clear();
	resetIntegrationsRuntimeForTests();
	await resetIntegrationOutboxForTests();
}
