export interface DeviceInfo {
  userAgent: string;
  platform: string;
  screenWidth: number;
  screenHeight: number;
  language: string;
  connectionType?: string;
}

/** Captures all device metadata required by the spec at check-in/check-out time. */
export function getDeviceInfo(): DeviceInfo {
  const nav = navigator;
  const conn = (nav as any).connection ?? (nav as any).mozConnection ?? (nav as any).webkitConnection;

  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    screenWidth: screen.width,
    screenHeight: screen.height,
    language: nav.language,
    connectionType: conn?.effectiveType ?? conn?.type ?? undefined,
  };
}
