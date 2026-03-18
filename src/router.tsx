import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function createRouter(queryClient: QueryClient) {
	return createTanStackRouter({
		routeTree,
		defaultPreload: 'intent',
		context: {
			queryClient,
		},
	});
}

export function getRouter() {
	const queryClient = new QueryClient();
	return createTanStackRouter({
		routeTree,
		defaultPreload: 'intent',
		context: {
			queryClient,
		},
	});
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof createRouter>;
	}
}
