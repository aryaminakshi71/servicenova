import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from '@tanstack/react-router';
// CSS is loaded via the SSR entry instead

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'ServiceNova AI - Field Service Management' },
			{
				name: 'description',
				content: 'AI-powered field service management and dispatch',
			},
		],
	}),
	component: RootDocument,
});

const queryClient = new QueryClient();

function RootDocument() {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<QueryClientProvider client={queryClient}>
					<Outlet />
					<Scripts />
				</QueryClientProvider>
			</body>
		</html>
	);
}
