import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldPlaySound: false,
		shouldSetBadge: false,
		shouldShowBanner: true,
		shouldShowList: true,
	}),
});

export type NotificationRegistrationResult = {
	ok: boolean;
	status: string;
	token: string | null;
	reason: string | null;
};

function resolveProjectId() {
	const easProjectId =
		Constants.easConfig?.projectId ??
		(Constants.expoConfig?.extra &&
		typeof Constants.expoConfig.extra === 'object' &&
		'eas' in Constants.expoConfig.extra &&
		(Constants.expoConfig.extra.eas as { projectId?: string } | undefined)
			?.projectId
			? (Constants.expoConfig.extra.eas as { projectId?: string } | undefined)
					?.projectId
			: undefined);

	return easProjectId ?? process.env.EXPO_PUBLIC_SERVICENOVA_EAS_PROJECT_ID;
}

export async function registerForPushNotificationsAsync(): Promise<NotificationRegistrationResult> {
	if (!Device.isDevice) {
		return {
			ok: false,
			status: 'simulator',
			token: null,
			reason: 'Push notifications require a physical iOS or Android device.',
		};
	}

	if (Platform.OS === 'android') {
		await Notifications.setNotificationChannelAsync('default', {
			name: 'default',
			importance: Notifications.AndroidImportance.MAX,
			lightColor: '#f6b73c',
			vibrationPattern: [0, 200, 200, 200],
		});
	}

	const existingPermissions = await Notifications.getPermissionsAsync();
	let finalStatus = existingPermissions.status;

	if (existingPermissions.status !== 'granted') {
		const requestedPermissions = await Notifications.requestPermissionsAsync();
		finalStatus = requestedPermissions.status;
	}

	if (finalStatus !== 'granted') {
		return {
			ok: false,
			status: finalStatus,
			token: null,
			reason: 'Notification permission was not granted.',
		};
	}

	const projectId = resolveProjectId();
	const pushToken = await Notifications.getExpoPushTokenAsync(
		projectId ? { projectId } : undefined,
	);

	return {
		ok: true,
		status: finalStatus,
		token: pushToken.data,
		reason: null,
	};
}

export function subscribeToNotifications(input: {
	onReceive: (notification: Notifications.Notification) => void;
	onRespond: (response: Notifications.NotificationResponse) => void;
}) {
	const receivedSubscription = Notifications.addNotificationReceivedListener(
		input.onReceive,
	);
	const responseSubscription =
		Notifications.addNotificationResponseReceivedListener(input.onRespond);

	return () => {
		receivedSubscription.remove();
		responseSubscription.remove();
	};
}

export async function scheduleTestNotificationAsync() {
	await Notifications.scheduleNotificationAsync({
		content: {
			title: 'ServiceNova Mobile',
			body: 'Dispatch test alert from the native mobile client.',
			data: {
				source: 'local-test',
			},
		},
		trigger: null,
	});
}
