var map = L.map('map').setView([65.0, 26.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12,
    minZoom: 5,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let selectedLat = null;
let selectedLng = null;

function sendCoordinates(lat, lon) {
    return fetch('http://127.0.0.1:5000/process-coordinates', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lat: Number(lat), lon: Number(lon) })
        
    })
    .then(response => response.json())
    .then(data => {
        console.log('Backend Response:', data);
        return data;
    })
    .catch(error => {
        console.error('Error sending coordinates:', error);
        throw error;
    });
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

            document.getElementById("coordinates").innerHTML =
                `📍 Selected Location: <strong>${place}</strong> (<strong>Lat:</strong> ${selectedLat.toFixed(4)}, <strong>Lng:</strong> ${selectedLng.toFixed(4)})`;

            sendCoordinates(selectedLat, selectedLng);
            getWeatherPrediction(place, null, null);
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

    document.getElementById("coordinates").innerHTML = 
        `📍 Selected Location: <strong>Lat:</strong> ${selectedLat}, <strong>Lng:</strong> ${selectedLng}`;
});

function handleSelect(lat, lng) {
    document.getElementById("location-title").textContent = 
        `Selected Location: ${lat},${lng}`;
    
    sendCoordinates(lat, lng)
        .then(() => {
            getWeatherPrediction(null, lat, lng);
        })
        .catch(error => console.error('Error:', error));
}

function getWeatherPrediction(city, lat, lon) {
    let url = "https://your-api.onrender.com/predict?";

    if (city) {
        url += `city=${encodeURIComponent(city)}`;
    } else if (lat && lon) {
        url += `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    } else {
        return;
    }

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                alert(`Prediction: ${data.prediction}`);
            }
        })
        .catch(error => console.error("Error fetching prediction:", error));
}