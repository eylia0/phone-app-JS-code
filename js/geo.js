// Location stamp for captures. Resolves null when location is unavailable
// (permission denied, no GPS, or the page isn't on https/localhost).
let lastFix = null;

export function getFix(maxAgeMs = 60000) {
    if (lastFix && Date.now() - lastFix.at < maxAgeMs) return Promise.resolve(lastFix);
    if (!navigator.geolocation) return Promise.resolve(null);
    return new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                lastFix = {
                    lat: +pos.coords.latitude.toFixed(6),
                    lng: +pos.coords.longitude.toFixed(6),
                    acc: Math.round(pos.coords.accuracy),
                    at: Date.now()
                };
                resolve(lastFix);
            },
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
        );
    });
}

export function mapsLink(geo) {
    return geo ? `https://www.google.com/maps?q=${geo.lat},${geo.lng}` : null;
}
