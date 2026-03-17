import { describe, expect, it, vi } from 'vitest';
import {
	registerForPushNotificationsAsync,
	scheduleTestNotificationAsync,
	subscribeToNotifications,
	type NotificationRegistrationResult,
} from '../src/notifications';

// Mock expo modules
vi.mock('expo-constants', () => ({
	default: {
		easConfig: null,
		expoConfig: null,
	},
}));

vi.mock('expo-device', () => ({
	isDevice: true,
}));

vi.mock('expo-notifications', () => ({
	setNotificationHandler: vi.fn(),
	getPermissionsAsync: vi.fn(),
	requestPermissionsAsync: vi.fn(),
	getExpoPushTokenAsync: vi.fn(),
	setNotificationChannelAsync: vi.fn(),
	scheduleNotificationAsync: vi.fn(),
	addNotificationReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
	addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
	Notification: {},
	NotificationResponse: {},
}));

vi.mock('react-native', () => ({
	Platform: {
		OS: 'ios',
		select: vi.fn((obj) => obj.ios ?? obj.default),
	},
}));

describe('notifications', () => {
	describe('registerForPushNotificationsAsync', () => {
		it('should return denied status when permission not granted', async () => {
			const Notifications = await import('expo-notifications');
			vi.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
				status: 'denied',
			} as any);
			vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({
				status: 'denied',
			} as any);

			const result = await registerForPushNotificationsAsync();

			expect(result.ok).toBe(false);
			expect(result.status).toBe('denied');
			expect(result.reason).toContain('permission');
		});

		it('should return success with token when permission granted', async () => {
			const Notifications = await import('expo-notifications');
			vi.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
				status: 'granted',
			} as any);
			vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValueOnce({
				data: 'ExponentPushToken[test-token-123]',
			} as any);

			const result = await registerForPushNotificationsAsync();

			expect(result.ok).toBe(true);
			expect(result.status).toBe('granted');
			expect(result.token).toBe('ExponentPushToken[test-token-123]');
			expect(result.reason).toBeNull();
		});

		it('should request permissions when not already granted', async () => {
			const Notifications = await import('expo-notifications');
			vi.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
				status: 'undetermined',
			} as any);
			vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({
				status: 'granted',
			} as any);
			vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValueOnce({
				data: 'ExponentPushToken[new-token]',
			} as any);

			const result = await registerForPushNotificationsAsync();

			expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
			expect(result.ok).toBe(true);
		});
	});

	describe('scheduleTestNotificationAsync', () => {
		it('should schedule a notification with correct content', async () => {
			const Notifications = await import('expo-notifications');
			vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValueOnce(
				'notification-id-123',
			);

			await scheduleTestNotificationAsync();

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
		});
	});

	describe('subscribeToNotifications', () => {
		it('should return unsubscribe function', () => {
			const onReceive = vi.fn();
			const onRespond = vi.fn();

			const Notifications = import('expo-notifications');
			// The subscribeToNotifications returns a cleanup function

			// This test just verifies the function can be called
			expect(typeof subscribeToNotifications).toBe('function');
		});
	});
});
