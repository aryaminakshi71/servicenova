import type { IntegrationAdapters } from './adapters';
import {
	createHttpCrmAdapter,
	createHttpInvoicingAdapter,
	resetHttpIntegrationReliabilityForTests,
} from './providers/http';
import { getMockAdapters, resetMockAdapters } from './providers/mock';

function buildAdapters(): IntegrationAdapters {
	const crmProvider = process.env.CRM_PROVIDER?.toLowerCase() ?? 'mock';
	const invoicingProvider =
		process.env.INVOICING_PROVIDER?.toLowerCase() ?? 'mock';
	const mockAdapters = getMockAdapters();

	const crm =
		crmProvider === 'http' && process.env.CRM_BASE_URL
			? createHttpCrmAdapter(process.env.CRM_BASE_URL, process.env.CRM_API_KEY)
			: mockAdapters.crm;

	const invoicing =
		invoicingProvider === 'http' && process.env.INVOICING_BASE_URL
			? createHttpInvoicingAdapter(
					process.env.INVOICING_BASE_URL,
					process.env.INVOICING_API_KEY,
				)
			: mockAdapters.invoicing;

	return {
		crm,
		invoicing,
	};
}

let adapters = buildAdapters();

export function getIntegrationAdapters() {
	return adapters;
}

export function resetIntegrationsRuntimeForTests() {
	resetMockAdapters();
	resetHttpIntegrationReliabilityForTests();
	adapters = buildAdapters();
}
