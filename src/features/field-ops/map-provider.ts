export type Coordinates = {
	lat: number;
	lng: number;
};

export type MapEtaRequest = {
	from: Coordinates;
	to: Coordinates;
	departureAt: Date;
	trafficLevel?: 'low' | 'normal' | 'high';
};

export type MapEtaResult = {
	distanceKm: number;
	etaMinutes: number;
};

export interface MapProvider {
	estimateEta(request: MapEtaRequest): MapEtaResult;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(value: number) {
	return (value * Math.PI) / 180;
}

function distanceKm(from: Coordinates, to: Coordinates) {
	const latDelta = toRadians(to.lat - from.lat);
	const lngDelta = toRadians(to.lng - from.lng);

	const fromLat = toRadians(from.lat);
	const toLat = toRadians(to.lat);

	const a =
		Math.sin(latDelta / 2) ** 2 +
		Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lngDelta / 2) ** 2;

	return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTrafficMultiplier(
	trafficLevel: 'low' | 'normal' | 'high',
	departureAt: Date,
) {
	if (trafficLevel === 'low') {
		return 0.9;
	}

	if (trafficLevel === 'high') {
		return 1.5;
	}

	const hour = departureAt.getHours();
	const isPeakHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19);

	return isPeakHour ? 1.35 : 1;
}

export class HeuristicMapProvider implements MapProvider {
	estimateEta(request: MapEtaRequest): MapEtaResult {
		const km = distanceKm(request.from, request.to);
		const baseSpeedKmh = 42;
		const multiplier = getTrafficMultiplier(
			request.trafficLevel ?? 'normal',
			request.departureAt,
		);
		const etaMinutes = Math.max(
			5,
			Math.round((km / baseSpeedKmh) * 60 * multiplier),
		);

		return {
			distanceKm: Number(km.toFixed(2)),
			etaMinutes,
		};
	}
}

export const defaultMapProvider: MapProvider = new HeuristicMapProvider();
