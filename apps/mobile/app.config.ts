import type { ExpoConfig } from 'expo/config';

const easProjectId =
	process.env.EXPO_PUBLIC_SERVICENOVA_EAS_PROJECT_ID ??
	process.env.SERVICENOVA_EAS_PROJECT_ID;

const config: ExpoConfig = {
	name: 'ServiceNova Mobile',
	slug: 'servicenova-mobile',
	version: '1.0.0',
	orientation: 'portrait',
	icon: './assets/icon.png',
	userInterfaceStyle: 'light',
	newArchEnabled: true,
	scheme: 'servicenova',
	splash: {
		image: './assets/splash-icon.png',
		resizeMode: 'contain',
		backgroundColor: '#08111f',
	},
	ios: {
		supportsTablet: true,
		bundleIdentifier: 'com.servicenova.mobile',
	},
	android: {
		adaptiveIcon: {
			foregroundImage: './assets/adaptive-icon.png',
			backgroundColor: '#08111f',
		},
		edgeToEdgeEnabled: true,
		predictiveBackGestureEnabled: false,
		package: 'com.servicenova.mobile',
	},
	web: {
		favicon: './assets/favicon.png',
	},
	plugins: ['expo-notifications'],
	extra: easProjectId
		? {
				eas: {
					projectId: easProjectId,
				},
			}
		: {},
};

export default config;
