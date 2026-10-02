// src/services/LocationEngine.ts
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
        
    if (typeof latitude === 'number' && typeof longitude === 'number') {
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