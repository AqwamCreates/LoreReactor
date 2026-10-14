// src/frontend_src/services/LocationEngine.ts
import tzlookup from 'tz-lookup';
import { DateTime } from 'luxon';

function degreesToCompass(degrees: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
}

export async function getLocation(): Promise<{ latitude: number; longitude: number } | null> {
    if (!navigator.geolocation) return null;

    try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 5000,
                maximumAge: 86400000,
            });
        });

        const coords = position.coords

        return {
            latitude: coords.latitude,
            longitude: coords.longitude,
        };
    } catch {
        console.warn('Geolocation unavailable or denied.');
        return null;
    }
}

export interface TimeData {
    rawTimestamp: number;
    formattedDate: string;
    formattedTime: string;
    luxonTimestamp: DateTime; // <--- ADD THIS
}

export function getTimeDataFromCoordinates(latitude?: number, longitude?: number): TimeData {
    
    let dt: DateTime | undefined;
        
    if (typeof latitude === 'number' && typeof longitude === 'number' && latitude !== 0 && longitude !== 0) {
        if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
            const timezone = tzlookup(latitude, longitude);
            dt = DateTime.now().setZone(timezone).reconfigure({ locale: 'en-US' });
        }
    }

    if (!dt) {
        const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone; // Gets "Asia/Kuala_Lumpur", etc.
        dt = DateTime.now().setZone(systemZone).reconfigure({ locale: 'en-US' });
    }

    return {
        rawTimestamp: dt.toMillis(),
        formattedDate: dt.toLocaleString({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        formattedTime: dt.toLocaleString({ hour: 'numeric', minute: '2-digit', hour12: true }),
        luxonTimestamp: dt
    };
}

export async function fetchCurrentWeather(latitude: number, longitude: number, apiKey: string): Promise<string | null> {
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=metric`;
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`Weather API returned ${response.status}`);
            return null;
        }

        const data = await response.json();

        const description = data.weather?.[0]?.description ?? 'unknown';
        const temperature = Math.round(data.main?.temp ?? 0);
        const feelsLike = Math.round(data.main?.feels_like ?? 0);
        const humidity = data.main?.humidity ?? 0;
        const windSpeed = Math.round((data.wind?.speed ?? 0) * 10) / 10;
        const windDirection = degreesToCompass(data.wind?.deg ?? 0);
        const clouds = data.clouds?.all ?? 0;
        const rainPrecipitation = data.rain ? `${data.rain['1h']}mm/h rain` : null;
        const snowPrecipitation = data.snow ? `${data.snow['1h']}mm/h snow` : null;

        const parts: string[] = [];
        parts.push(`${description}, ${temperature}°C (feels like ${feelsLike}°C)`);
        parts.push(`Wind ${windSpeed} m/s from the ${windDirection}`);
        parts.push(`Humidity ${humidity}%`);

        if (clouds > 0) {
            if (clouds >= 90) parts.push('Overcast skies');
            else if (clouds >= 60) parts.push('Mostly cloudy');
            else if (clouds >= 30) parts.push('Partly cloudy');
            else parts.push('Mostly clear');
        } else {
            parts.push('Clear skies');
        }

        if (rainPrecipitation) parts.push(rainPrecipitation);
        if (snowPrecipitation) parts.push(snowPrecipitation);

        return `${parts.join('. ')}.`;
    } catch (e) {
        console.warn('Failed to fetch weather:', e);
        return null;
    }
}

// ─── Mathematical Helpers ──────────────────────────────────────────
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const sin = (d: number) => Math.sin(d * RAD);
const cos = (d: number) => Math.cos(d * RAD);
const asin = (v: number) => Math.asin(Math.max(-1, Math.min(1, v))) * DEG;
const atan2 = (y: number, x: number) => Math.atan2(y, x) * DEG;

function normalizeDeg(deg: number): number {
    const d = deg % 360;
    return d < 0 ? d + 360 : d;
}

// ─── Celestial Interfaces ──────────────────────────────────────────
export interface CelestialData {
    sunAltitude: number;             // Degrees (-90 to +90)
    sunAzimuth: number;              // Degrees (0 to 360)
    sunCompass: string;              // 'North', 'South-East', etc.
    skyState: 'midday' | 'daylight' | 'golden_hour' | 'sunset_sunrise' | 'civil_twilight' | 'nautical_twilight' | 'astronomical_twilight' | 'night';
    
    moonAltitude: number;            // Degrees (-90 to +90)
    moonAzimuth: number;
    moonCompass: string;
    moonIsAboveHorizon: boolean;     // Altitude > 0
    moonIlluminationPercent: number; // 0 to 100
    moonPhaseName: string;           // 'Full Moon', 'Waxing Crescent', etc.
    
    starsVisible: 'none' | 'few_planets_brightest' | 'major_constellations' | 'vivid_starfield';
    summaryDescription: string;
}

// ─── Self-Contained Astronomical Engine ─────────────────────────────
export function calculateCelestialData(date: Date, lat = 0, lon = 0): CelestialData {
    // Days since Jan 0.0, 2000 (JD 2451543.5)
    const d = (date.getTime() / 86400000) - 10956.0;

    // 1. Sun Position
    const wS = 282.9404 + 4.70935e-5 * d;
    const eS = 0.016709 - 1.151e-9 * d;
    const MS = normalizeDeg(356.0470 + 0.9856002585 * d);
    
    // Obliquity of the Ecliptic
    const obliq = 23.4393 - 3.563e-7 * d;

    // Sun True Longitude
    const ES = MS + DEG * eS * sin(MS) * (1 + eS * cos(MS));
    const xS = cos(ES) - eS;
    const yS = sin(ES) * Math.sqrt(1 - eS * eS);
    const vS = atan2(yS, xS);
    const lonS = normalizeDeg(vS + wS);

    // Sun Equatorial
    const xS_eq = cos(lonS);
    const yS_eq = sin(lonS) * cos(obliq);
    const zS_eq = sin(lonS) * sin(obliq);
    const raS = normalizeDeg(atan2(yS_eq, xS_eq));
    const decS = asin(zS_eq);

    // 2. Moon Position
    const NM = normalizeDeg(125.1228 - 0.0529538083 * d);
    const iM = 5.1454;
    const wM = normalizeDeg(318.0634 + 0.1643573223 * d);
    const aM = 60.2666;
    const eM = 0.054900;
    const MM = normalizeDeg(115.3654 + 13.0649929509 * d);

    const EM = MM + DEG * eM * sin(MM) * (1 + eM * cos(MM));
    const xM = aM * (cos(EM) - eM);
    const yM = aM * Math.sqrt(1 - eM * eM) * sin(EM);
    const vM = atan2(yM, xM);
    const distM = Math.sqrt(xM * xM + yM * yM);

    // Position in orbital plane
    const xh = distM * (cos(NM) * cos(vM + wM) - sin(NM) * sin(vM + wM) * cos(iM));
    const yh = distM * (sin(NM) * cos(vM + wM) + cos(NM) * sin(vM + wM) * cos(iM));
    const zh = distM * (sin(vM + wM) * sin(iM));

    let lonM = normalizeDeg(atan2(yh, xh));
    const latM = atan2(zh, Math.sqrt(xh * xh + yh * yh));

    // Major Lunar Perturbations
    lonM += 1.274 * sin(2 * (lonM - lonS) - MM); // Evection
    lonM += 0.558 * sin(2 * (lonM - lonS));       // Variation
    lonM -= 0.186 * sin(MS);                      // Yearly equation
    lonM = normalizeDeg(lonM);

    // Moon Equatorial
    const xM_eq = cos(latM) * cos(lonM);
    const yM_eq = cos(latM) * sin(lonM) * cos(obliq) - sin(latM) * sin(obliq);
    const zM_eq = cos(latM) * sin(lonM) * sin(obliq) + sin(latM) * cos(obliq);
    const raM = normalizeDeg(atan2(yM_eq, xM_eq));
    const decM = asin(zM_eq);

    // 3. Sidereal Time & Local Hour Angles
    const UT = (date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600);
    const GMST0 = normalizeDeg(wS + MS + 180);
    const LST = normalizeDeg(GMST0 + UT * 15 + lon);

    const haS = normalizeDeg(LST - raS);
    const haM = normalizeDeg(LST - raM);

    // 4. Horizontal Coordinates (Altitude / Azimuth)
    const sunAlt = asin(sin(lat) * sin(decS) + cos(lat) * cos(decS) * cos(haS));
    const sunAz = normalizeDeg(atan2(-cos(decS) * sin(haS), cos(lat) * sin(decS) - sin(lat) * cos(decS) * cos(haS)));

    const moonAlt = asin(sin(lat) * sin(decM) + cos(lat) * cos(decM) * cos(haM));
    const moonAz = normalizeDeg(atan2(-cos(decM) * sin(haM), cos(lat) * sin(decM) - sin(lat) * cos(decM) * cos(haM)));

    // 5. Moon Phase & Illumination
    const elongation = Math.acos(cos(latM) * cos(lonM - lonS)) * DEG;
    const illuminationPercent = Math.round(((1 - cos(elongation)) / 2) * 100);
    const phaseDiff = normalizeDeg(lonM - lonS);

    let moonPhaseName: string;
    if (phaseDiff >= 345 || phaseDiff < 15) moonPhaseName = 'New Moon';
    else if (phaseDiff < 75) moonPhaseName = 'Waxing Crescent';
    else if (phaseDiff < 105) moonPhaseName = 'First Quarter';
    else if (phaseDiff < 165) moonPhaseName = 'Waxing Gibbous';
    else if (phaseDiff < 195) moonPhaseName = 'Full Moon';
    else if (phaseDiff < 255) moonPhaseName = 'Waning Gibbous';
    else if (phaseDiff < 285) moonPhaseName = 'Last Quarter';
    else moonPhaseName = 'Waning Crescent';

    // 6. Sky State Categorization
    let skyState: CelestialData['skyState'];
    let starsVisible: CelestialData['starsVisible'];

    if (sunAlt > 45) {
        skyState = 'midday';
        starsVisible = 'none';
    } else if (sunAlt > 10) {
        skyState = 'daylight';
        starsVisible = 'none';
    } else if (sunAlt > 0) {
        skyState = 'golden_hour';
        starsVisible = 'none';
    } else if (sunAlt > -0.83) {
        skyState = 'sunset_sunrise';
        starsVisible = 'none';
    } else if (sunAlt > -6) {
        skyState = 'civil_twilight';
        starsVisible = 'few_planets_brightest';
    } else if (sunAlt > -12) {
        skyState = 'nautical_twilight';
        starsVisible = 'major_constellations';
    } else if (sunAlt > -18) {
        skyState = 'astronomical_twilight';
        starsVisible = 'vivid_starfield';
    } else {
        skyState = 'night';
        starsVisible = 'vivid_starfield';
    }

    // 7. Natural Descriptive Synthesis
    const sunCompass = degreesToCompass(sunAz);
    const moonCompass = degreesToCompass(moonAz);
    const moonAbove = moonAlt > 0;

    const parts: string[] = [];

    // Sun & Sky light clause
    if (skyState === 'midday') {
        parts.push(`Brilliant midday sunlight. The sun is high overhead towards the ${sunCompass.toLowerCase()}.`);
    } else if (skyState === 'daylight') {
        parts.push(`Clear daylight. The sun is shining brightly from the ${sunCompass.toLowerCase()}.`);
    } else if (skyState === 'golden_hour') {
        parts.push(`Golden hour. The low sun in the ${sunCompass.toLowerCase()} casts long, warm shadows and an amber glow.`);
    } else if (skyState === 'sunset_sunrise') {
        parts.push(`The sun is cresting the horizon in the ${sunCompass.toLowerCase()}, painting the sky in deep orange and violet hues.`);
    } else if (skyState === 'civil_twilight') {
        parts.push("Civil twilight. The sky glows with fading dusk colors, and the brightest stars and planets are beginning to pierce the twilight.");
    } else if (skyState === 'nautical_twilight') {
        parts.push("Nautical twilight. The horizon is faint; the sky is a deep velvet indigo with prominent stars visible.");
    } else if (skyState === 'astronomical_twilight') {
        parts.push("Astronomical twilight. The last traces of daylight have vanished; a full canopy of stars is emerging.");
    } else {
        parts.push("Night. The sky is dark and filled with stars.");
    }

    // Moon clause
    if (moonAbove) {
        if (skyState === 'night' || skyState === 'nautical_twilight' || skyState === 'astronomical_twilight') {
            const heightStr = moonAlt > 50 ? 'high overhead' : `in the ${moonCompass.toLowerCase()} sky`;
            parts.push(`A ${moonPhaseName} (${illuminationPercent}% illuminated) shines ${heightStr}, casting silver moonlight.`);
        } else if (skyState === 'golden_hour' || skyState === 'civil_twilight') {
            parts.push(`A pale ${moonPhaseName} (${illuminationPercent}% illuminated) is faintly visible in the ${moonCompass.toLowerCase()} sky.`);
        }
    } else {
        if (skyState === 'night') {
            parts.push("The moon has set below the horizon.");
        }
    }

    return {
        sunAltitude: Math.round(sunAlt * 10) / 10,
        sunAzimuth: Math.round(sunAz * 10) / 10,
        sunCompass,
        skyState,
        moonAltitude: Math.round(moonAlt * 10) / 10,
        moonAzimuth: Math.round(moonAz * 10) / 10,
        moonCompass,
        moonIsAboveHorizon: moonAbove,
        moonIlluminationPercent: illuminationPercent,
        moonPhaseName,
        starsVisible,
        summaryDescription: parts.join(' '),
    };
}

export function generateSkyViewText(timestamp: number | Date, latitude?: number, longitude?: number): string {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const data = calculateCelestialData(date, latitude ?? 0, longitude ?? 0);
    return data.summaryDescription;
}