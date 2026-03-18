import type {
	CrmAdapter,
	CrmCustomerRecord,
	CrmWorkOrderEvent,
	IntegrationAdapters,
	InvoiceRecord,
	InvoiceRequest,
	InvoicingAdapter,
} from '../adapters';

const mockCustomers: Record<string, CrmCustomerRecord> = {
	'cust-101': {
		customerId: 'cust-101',
		customerName: 'Aster Tower Ops',
		tier: 'enterprise',
		openServiceCount: 2,
		lastServiceAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
		notes: ['24/7 coverage', 'Escalate HVAC incidents immediately'],
	},
	'cust-205': {
		customerId: 'cust-205',
		customerName: 'Harbor Commerce Ltd',
		tier: 'priority',
		openServiceCount: 1,
		lastServiceAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
		notes: ['Site access badge required'],
	},
	'cust-307': {
		customerId: 'cust-307',
		customerName: 'Mission Row Residences',
		tier: 'standard',
		openServiceCount: 3,
		lastServiceAt: new Date(Date.now() - 1000 * 60 * 60 * 60).toISOString(),
		notes: ['Call ahead before arrival'],
	},
};

const mockInvoices: InvoiceRecord[] = [];
const crmEvents: CrmWorkOrderEvent[] = [];

function randomId(prefix: string) {
	return `${prefix}-${crypto.randomUUID()}`;
}

const mockCrmAdapter: CrmAdapter = {
	getCustomerContext(customerId) {
		return mockCustomers[customerId] ?? null;
	},
	recordWorkOrderEvent(event) {
		crmEvents.unshift(event);

		const customer = mockCustomers[event.customerId];

		if (!customer) {
			return;
		}

		customer.lastServiceAt = event.timestamp;
		if (event.status === 'closed') {
			customer.openServiceCount = Math.max(0, customer.openServiceCount - 1);
		}
	},
};

const mockInvoicingAdapter: InvoicingAdapter = {
	createInvoice(request: InvoiceRequest) {
		const existing = mockInvoices.find(
			(invoice) => invoice.jobId === request.jobId,
		);

		if (existing) {
			return existing;
		}

		const invoice: InvoiceRecord = {
			id: randomId('inv'),
			jobId: request.jobId,
			customerId: request.customerId,
			currency: request.currency,
			status: 'issued',
			subtotalCents: request.subtotalCents,
			taxCents: request.taxCents,
			totalCents: request.totalCents,
			lineItems: request.lineItems,
			createdAt: new Date().toISOString(),
		};

		mockInvoices.unshift(invoice);
		return invoice;
	},
	getInvoice(invoiceId) {
		return mockInvoices.find((invoice) => invoice.id === invoiceId) ?? null;
	},
	listInvoices() {
		return mockInvoices;
	},
};

export function getMockAdapters(): IntegrationAdapters {
	return {
		crm: mockCrmAdapter,
		invoicing: mockInvoicingAdapter,
	};
}

export function resetMockAdapters() {
	mockInvoices.splice(0, mockInvoices.length);
	crmEvents.splice(0, crmEvents.length);
}
