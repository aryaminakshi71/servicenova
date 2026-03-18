import AsyncStorage from '@react-native-async-storage/async-storage';

export type PersistedRuntimeConfig = {
	baseUrl: string;
	authToken: string;
	activeTab: 'overview' | 'jobs' | 'incidents' | 'settings';
	pushEnabled: boolean;
	expoPushToken: string | null;
};

const storageKey = 'servicenova.mobile.runtime.v1';

function normalizePersistedConfig(
	value: Partial<PersistedRuntimeConfig> | null | undefined,
	fallbacks: PersistedRuntimeConfig,
): PersistedRuntimeConfig {
	return {
		baseUrl:
			typeof value?.baseUrl === 'string' && value.baseUrl.trim().length > 0
				? value.baseUrl
				: fallbacks.baseUrl,
		authToken:
			typeof value?.authToken === 'string' && value.authToken.trim().length > 0
				? value.authToken
				: fallbacks.authToken,
		activeTab:
			value?.activeTab === 'overview' ||
			value?.activeTab === 'jobs' ||
			value?.activeTab === 'incidents' ||
			value?.activeTab === 'settings'
				? value.activeTab
				: fallbacks.activeTab,
		pushEnabled:
			typeof value?.pushEnabled === 'boolean'
				? value.pushEnabled
				: fallbacks.pushEnabled,
		expoPushToken:
			typeof value?.expoPushToken === 'string' || value?.expoPushToken === null
				? value.expoPushToken
				: fallbacks.expoPushToken,
	};
}

export async function loadPersistedRuntimeConfig(
	fallbacks: PersistedRuntimeConfig,
) {
	try {
		const raw = await AsyncStorage.getItem(storageKey);

		if (!raw) {
			return fallbacks;
		}

		const parsed = JSON.parse(raw) as Partial<PersistedRuntimeConfig>;
		return normalizePersistedConfig(parsed, fallbacks);
	} catch {
		return fallbacks;
	}
}

export async function persistRuntimeConfig(config: PersistedRuntimeConfig) {
	await AsyncStorage.setItem(storageKey, JSON.stringify(config));
}
