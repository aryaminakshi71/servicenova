import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock AsyncStorage before importing the modules
vi.mock('@react-native-async-storage/async-storage', () => ({
	default: {
		getItem: vi.fn(),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn(),
	},
}));

// Mock expo-constants
vi.mock('expo-constants', () => ({
	default: {
		easConfig: null,
		expoConfig: null,
		manifest: null,
		runtimeVersion: null,
		platform: null,
		statusBarHeight: 0,
		deviceYearClass: null,
		installationId: 'test-id',
	},
}));

// Mock expo-notifications
vi.mock('expo-notifications', () => ({
	setNotificationHandler: vi.fn(),
	getPermissionsAsync: vi.fn(),
	requestPermissionsAsync: vi.fn(),
	getExpoPushTokenAsync: vi.fn(),
	setNotificationChannelAsync: vi.fn(),
	scheduleNotificationAsync: vi.fn(),
	addNotificationReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
	addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
	AndroidImportance: {
		MAX: 4,
		HIGH: 3,
		DEFAULT: 3,
	},
	Notification: {},
	NotificationResponse: {},
}));

// Mock expo-device
vi.mock('expo-device', () => ({
	isDevice: true,
}));

// Mock expo-modules-core
vi.mock('expo-modules-core', () => ({
	NativeModulesProxy: {},
	TurboModuleRegistry: {},
	requireNativeModule: vi.fn(() => ({})),
	requireOptionalNativeModule: vi.fn(() => null),
}));

// Mock react-native Platform
vi.mock('react-native', () => ({
	Platform: {
		OS: 'ios',
		select: vi.fn((obj) => obj.ios ?? obj.default),
	},
	TurboModuleRegistry: {},
	NativeModules: {},
	NativeModulesProxy: {},
}));

describe('Mobile App Integration', () => {
	describe('Storage and Notifications Flow', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('should load config and prepare for notifications', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			const Notifications = await import('expo-notifications');

			// Setup mocks
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValue(
				JSON.stringify({
					baseUrl: 'http://192.168.1.100:3008',
					authToken: 'Bearer manager:mobile-ops:tenant-mobile',
					activeTab: 'overview',
					pushEnabled: true,
					expoPushToken: null,
				}),
			);

			vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
				status: 'granted',
			} as unknown as Parameters<typeof Notifications.getPermissionsAsync>[0]);

			vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
				data: 'ExponentPushToken[test-integration-token]',
			} as unknown as ReturnType<typeof Notifications.getExpoPushTokenAsync>);

			// Import after setting up mocks
			const { loadPersistedRuntimeConfig } = await import(
				'../src/mobile-storage'
			);
			const { registerForPushNotificationsAsync } = await import(
				'../src/notifications'
			);

			// Execute the flow
			const config = await loadPersistedRuntimeConfig({
				baseUrl: 'http://localhost:3008',
				authToken: 'Bearer default-token',
				activeTab: 'overview',
				pushEnabled: false,
				expoPushToken: null,
			});

			const notificationResult = await registerForPushNotificationsAsync();

			// Verify results
			expect(config.baseUrl).toBe('http://192.168.1.100:3008');
			expect(config.authToken).toBe('Bearer manager:mobile-ops:tenant-mobile');
			expect(notificationResult.ok).toBe(true);
			expect(notificationResult.token).toBe(
				'ExponentPushToken[test-integration-token]',
			);
		});

		it('should persist config changes correctly', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			const { persistRuntimeConfig } = await import('../src/mobile-storage');

			vi.mocked(AsyncStorage.default.setItem).mockResolvedValue();

			await persistRuntimeConfig({
				baseUrl: 'http://new-api.example.com',
				authToken: 'Bearer new-token',
				activeTab: 'jobs',
				pushEnabled: true,
				expoPushToken: 'new-push-token',
			});

			expect(AsyncStorage.default.setItem).toHaveBeenCalledWith(
				'servicenova.mobile.runtime.v1',
				expect.stringContaining('new-api.example.com'),
			);
		});

		it('should handle notification permission denied gracefully', async () => {
			const Notifications = await import('expo-notifications');

			vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
				status: 'denied',
			} as unknown as Parameters<typeof Notifications.getPermissionsAsync>[0]);
			vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
				status: 'denied',
			} as unknown as Parameters<
				typeof Notifications.requestPermissionsAsync
			>[0]);

			const { registerForPushNotificationsAsync } = await import(
				'../src/notifications'
			);

			const result = await registerForPushNotificationsAsync();

			expect(result.ok).toBe(false);
			expect(result.status).toBe('denied');
			expect(result.reason).toContain('permission');
			expect(result.token).toBeNull();
		});

		it('should schedule test notification successfully', async () => {
			const Notifications = await import('expo-notifications');
			const { scheduleTestNotificationAsync } = await import(
				'../src/notifications'
			);

			vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue(
				'test-notification-id',
			);

			const _notificationId = await scheduleTestNotificationAsync();

			expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
				content: {
					title: 'ServiceNova Mobile',
					body: 'Dispatch test alert from the native mobile client.',
					data: {
						source: 'local-test',
					},
				},
				trigger: null,
			});

			// Verify the mock was called (the function returns void)
			expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
		});
	});

	describe('Tab Navigation State', () => {
		it('should persist and restore active tab state', async () => {
			const AsyncStorage = await import(
				'@react-native-async-storage/async-storage'
			);
			const { loadPersistedRuntimeConfig, persistRuntimeConfig } = await import(
				'../src/mobile-storage'
			);

			// Mock initial load - no stored config
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValue(null);
			vi.mocked(AsyncStorage.default.setItem).mockResolvedValue();

			// Load with default tab
			const defaultConfig = await loadPersistedRuntimeConfig({
				baseUrl: 'http://localhost:3008',
				authToken: 'Bearer token',
				activeTab: 'overview',
				pushEnabled: false,
				expoPushToken: null,
			});

			expect(defaultConfig.activeTab).toBe('overview');

			// User switches to jobs tab
			await persistRuntimeConfig({
				...defaultConfig,
				activeTab: 'jobs',
			});

			// Simulate app restart - load saved config
			vi.mocked(AsyncStorage.default.getItem).mockResolvedValue(
				JSON.stringify({
					activeTab: 'jobs',
				}),
			);

			const restoredConfig = await loadPersistedRuntimeConfig({
				baseUrl: 'http://localhost:3008',
				authToken: 'Bearer token',
				activeTab: 'overview',
				pushEnabled: false,
				expoPushToken: null,
			});

			expect(restoredConfig.activeTab).toBe('jobs');
		});
	});
});
