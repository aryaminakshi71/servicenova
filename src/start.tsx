import 'tailwindcss';
import './styles.css';
import './platform-ui.css';

import { createStart } from '@tanstack/react-start';

export const startInstance = createStart(() => {
	return {
		defaultSsr: false,
	};
});
