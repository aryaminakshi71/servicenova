import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initPlatformObservability } from './lib/platform-observability';
import './styles.css';
import './platform-ui.css';

initPlatformObservability({ appId: 'servicenova' });

const rootElement = document.getElementById('root');
if (rootElement) {
	ReactDOM.createRoot(rootElement).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
}
