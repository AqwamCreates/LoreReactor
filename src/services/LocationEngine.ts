// src/services/LocationEngine.ts
import { find } from 'geo-tz';
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

        return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
        };
    } catch {
        console.warn('Geolocation unavailable or denied.');
        return null;
    }
}

/**
 * Get accurate local time string from coordinates using IANA timezone database.
 * Handles DST, political timezone boundaries, and half-hour offsets correctly.
 */
export function getLocalTimeFromCoordinates(latitude: number, longitude: number): number | null {
    const timezones = find(latitude, longitude);
    if (!timezones || timezones.length === 0) return null;

    const dt = DateTime.now().setZone(timezones[0]);
    if (!dt.isValid) return null;
    const seconds = dt.toUnixInteger()
    const milliseconds = seconds * 1000

    return milliseconds;
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