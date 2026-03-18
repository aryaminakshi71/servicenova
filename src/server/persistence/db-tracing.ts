import { withSpan } from '../tracing';

export async function withDbSpan<T>(
	operation: string,
	input: {
		tenantId?: string | null;
		entity?: string;
	} = {},
	fn: () => Promise<T>,
) {
	return withSpan(
		`db.${operation}`,
		{
			'db.system': 'postgresql',
			'db.operation': operation,
			'db.entity': input.entity ?? 'unknown',
			'servicenova.tenant_id': input.tenantId?.trim() || 'default',
		},
		fn,
	);
}
