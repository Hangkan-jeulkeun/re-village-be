import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  geminiBaseUrl: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com',
  gpsApiKey: process.env.GPS_API_KEY ?? '',
  gpsGeocodeUrl:
    process.env.GPS_GEOCODE_URL ?? 'https://maps.googleapis.com/maps/api/geocode/json',
  gpsReverseGeocodeUrl:
    process.env.GPS_REVERSE_GEOCODE_URL ?? 'https://maps.googleapis.com/maps/api/geocode/json',
  tourApiKey: process.env.TOUR_API_KEY ?? '',
  tourApiBaseUrl:
    process.env.TOUR_API_BASE_URL ??
    'https://apis.data.go.kr/B551011/KorService2/locationBasedList2',
  tourMobileOs: process.env.TOUR_API_MOBILE_OS ?? 'ETC',
  tourMobileApp: process.env.TOUR_API_MOBILE_APP ?? 'JejuReVillage',
  tourRadiusMeters: Number(process.env.TOUR_API_RADIUS_METERS ?? 3000),
  tourNumRows: Number(process.env.TOUR_API_NUM_ROWS ?? 5),
}));
