var map = L.map('map').setView([65.0, 26.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12,
    minZoom: 5,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let selectedLat = null;
let selectedLng = null;

function sendCoordinates(lat, lon) {
    return fetch('https://weatherforecasting-flax.vercel.app/process-coordinates', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lat: Number(lat), lon: Number(lon) })
    })
    .then(response => response.json())
    .then(data => {
        console.log('Backend Response:', data);
        displayWeatherData(data.prediction || data);
        return data;
    })
    .catch(error => {
        console.error('Error sending coordinates:', error);
        throw error;
    });
}

function displayWeatherData(predictionData) {
    const weatherItems = document.querySelectorAll(".weather-item");
    if (Array.isArray(predictionData)) {
        predictionData.forEach((hourData, index) => {
            if (index < weatherItems.length) {
                function formatHour(hour) {
                    return `${hour.toString().padStart(2, '0')}:00`;
                }
                weatherItems[index].querySelector(".weather-time").textContent = `
                ${formatHour(hourData.hour)}`;
                weatherItems[index].querySelector(".weather-box").innerHTML = `
                <div class="weather-top">
                    <span class="temp">${hourData.temperature_2m_next.toFixed(1)}°C</span>
                </div>
                <div class="weather-bottom">
                    <div class="grid-cell">
                        <i class="fa-solid fa-cloud-rain"></i> ${hourData.precipitation_next.toFixed(1)} mm
                    </div>
                    <div class="grid-cell">
                        <i class="fas fa-droplet"></i> ${hourData.relative_humidity_2m_next.toFixed(1)}%
                    </div>
                    <div class="grid-cell">
                        <i class="fas fa-wind"></i> ${hourData.wind_speed_10m_next.toFixed(1)} m/s
                    </div>
                    <div class="grid-cell">
                        <i class="fas fa-snowflake"></i> ${hourData.snowfall_next.toFixed(1)} cm
                    </div>
                </div>
                `;
                const detailsDiv = weatherItems[index].querySelector(".weather-details");
                detailsDiv.innerHTML = ``;
                
                if (hourData.snowfall_next > 0) {
                    detailsDiv.innerHTML += `<br>Snow: ${hourData.snowfall_next.toFixed(1)} cm`;
                }
            }
        });
    }
    
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    document.getElementById("location-title").textContent = `
        ${now.toLocaleDateString('fi-FI')}\n
    `;
}

function searchLocation(place) {
    var url = `https://nominatim.openstreetmap.org/search?format=json&q=${place}`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.length === 0) {
                alert("Location not found. Try a different name.");
                return;
            }

            selectedLat = parseFloat(data[0].lat);
            selectedLng = parseFloat(data[0].lon);

            map.setView([selectedLat, selectedLng], 10);

            map.eachLayer(function (layer) {
                if (layer instanceof L.Marker) {
                    map.removeLayer(layer);
                }
            });

            var marker = L.marker([selectedLat, selectedLng]).addTo(map)
                .bindPopup(`📍 ${place}<br>Lat: ${selectedLat.toFixed(4)}, Lng: ${selectedLng.toFixed(4)}`)
                .openPopup();
            sendCoordinates(selectedLat, selectedLng);
        })
        .catch(error => console.log("Error fetching location:", error));
}

map.on('click', function (e) {
    selectedLat = Number(e.latlng.lat.toFixed(4));
    selectedLng = Number(e.latlng.lng.toFixed(4));

    map.eachLayer(function (layer) {
        if (layer instanceof L.Marker) {
            map.removeLayer(layer);
        }
    });

    var marker = L.marker([selectedLat, selectedLng]).addTo(map);
    marker.bindPopup(`
        <div>
            📍 Selected Location:<br>
            Lat: ${selectedLat}<br>
            Lng: ${selectedLng}<br>
            <button onclick="handleSelect(${selectedLat}, ${selectedLng})" class="select-button">Select</button>
        </div>
    `).openPopup();
});

function handleSelect(lat, lng) {
    sendCoordinates(lat, lng)
        .then(() => {
            map.closePopup();
        })
        .catch(error => console.error('Error:', error));
}

function loadTestData() {
    const data = [
    ];
    displayWeatherData(data);
}

window.addEventListener('DOMContentLoaded', function() {
    sendCoordinates(60.1729, 24.941);
});
window.addEventListener("load", function() {
    setTimeout(function() {
        map.invalidateSize();
    }, 300);
});