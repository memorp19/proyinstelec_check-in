export interface GeoPosition {
  lat: number;
  lng: number;
  precision: number; // accuracy in metres
  timestamp: string; // ISO 8601 UTC
}

export type GeoError =
  | { code: "PERMISSION_DENIED"; message: string }
  | { code: "UNAVAILABLE"; message: string }
  | { code: "TIMEOUT"; message: string };

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
};

/**
 * Wraps the Geolocation API in a promise.
 * Rejects with a typed GeoError so the UI can show a specific message.
 */
export function getCurrentPosition(
  options: PositionOptions = GEO_OPTIONS,
): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: "UNAVAILABLE", message: "Geolocalización no disponible en este dispositivo." } satisfies GeoError);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: Math.round(pos.coords.accuracy),
          timestamp: new Date(pos.timestamp).toISOString(),
        }),
      (err) => {
        const code: GeoError["code"] =
          err.code === 1 ? "PERMISSION_DENIED"
          : err.code === 3 ? "TIMEOUT"
          : "UNAVAILABLE";
        reject({ code, message: err.message } satisfies GeoError);
      },
      options,
    );
  });
}
