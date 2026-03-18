import { describe, expect, it } from 'vitest';
import {
	loadPersistedRuntimeConfig,
	type PersistedRuntimeConfig,
	persistRuntimeConfig,
} from '../src/mobile-storage';

// Mock AsyncStorage
vi.mock('@react-native-async-storage/async-storage', () => ({
	default: {
		getItem: vi.fn(),
		setItem: vi.fn(),
		removeItem: vi.fn(),
	},
}));

const defaultConfig: PersistedRuntimeConfig = {
	baseUrl: 'http://localhost:3008',
	authToken: 'Bearer demo-token',
	activeTab: 'overview',
	pushEnabled: false,
	expoPushToken: null,
};

describe('mobile-storage', () => {
	describe('loadPersistedRuntimeConfig', () => {
		it('should return fallbacks when no stored config exists', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValueOnce(null);

			const result = await loadPersistedRuntimeConfig(defaultConfig);

			expect(result).toEqual(defaultConfig);
		});

		it('should return fallbacks when stored config is invalid JSON', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValueOnce(
				'invalid-json',
			);

			const result = await loadPersistedRuntimeConfig(defaultConfig);

			expect(result).toEqual(defaultConfig);
		});

		it('should return normalized config when valid config exists', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValueOnce(
				JSON.stringify({
					baseUrl: 'http://custom.example.com',
					authToken: 'Bearer custom-token',
					activeTab: 'jobs',
					pushEnabled: true,
					expoPushToken: 'test-token-123',
				}),
			);

			const result = await loadPersistedRuntimeConfig(defaultConfig);

			expect(result.baseUrl).toBe('http://custom.example.com');
			expect(result.authToken).toBe('Bearer custom-token');
			expect(result.activeTab).toBe('jobs');
			expect(result.pushEnabled).toBe(true);
			expect(result.expoPushToken).toBe('test-token-123');
		});

		it('should use fallbacks for missing fields', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValueOnce(
				JSON.stringify({
					baseUrl: 'http://partial.example.com',
				}),
			);

			const result = await loadPersistedRuntimeConfig(defaultConfig);

			expect(result.baseUrl).toBe('http://partial.example.com');
			expect(result.authToken).toBe(defaultConfig.authToken);
			expect(result.activeTab).toBe(defaultConfig.activeTab);
		});

		it('should use fallbacks for invalid field values', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValueOnce(
				JSON.stringify({
					baseUrl: '', // empty string should use fallback
					activeTab: 'invalid-tab', // invalid tab should use fallback
				}),
			);

			const result = await loadPersistedRuntimeConfig(defaultConfig);

			expect(result.baseUrl).toBe(defaultConfig.baseUrl);
			expect(result.activeTab).toBe(defaultConfig.activeTab);
		});

		it('should handle null expoPushToken', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValueOnce(
				JSON.stringify({
					expoPushToken: null,
				}),
			);

			const result = await loadPersistedRuntimeConfig(defaultConfig);

			expect(result.expoPushToken).toBeNull();
		});
	});

	describe('persistRuntimeConfig', () => {
		it('should store config as JSON string', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			vi.mocked(AsyncStorage.default.setItem).mockResolvedValueOnce();

			await persistRuntimeConfig(defaultConfig);

			expect(AsyncStorage.default.setItem).toHaveBeenCalledWith(
				'servicenova.mobile.runtime.v1',
				JSON.stringify(defaultConfig),
			);
		});

		it('should store custom config correctly', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			vi.mocked(AsyncStorage.default.setItem).mockResolvedValueOnce();

			const customConfig: PersistedRuntimeConfig = {
				baseUrl: 'http://custom.example.com',
				authToken: 'Bearer custom-token',
				activeTab: 'settings',
				pushEnabled: true,
				expoPushToken: 'token-123',
			};

			await persistRuntimeConfig(customConfig);

			expect(AsyncStorage.default.setItem).toHaveBeenCalledWith(
				'servicenova.mobile.runtime.v1',
				JSON.stringify(customConfig),
			);
		});
	});
});
