from http.server import BaseHTTPRequestHandler
import json
import requests
import joblib
import numpy as np
import pandas as pd
import tensorflow as tf
from datetime import datetime, timedelta

model = tf.keras.models.load_model("./api/hybrid_weather_model.h5")
scaler_minmax = joblib.load("./api/scaler_minmax.pkl")
scaler_standard = joblib.load("./api/scaler_standard.pkl")
min_lat, max_lat, min_lon, max_lon = joblib.load("./api/scaler_coordinates.pkl")

def process_weather(lat, lon):
    now = datetime.now()
    yesterday = (now - timedelta(hours=24)).strftime("%Y-%m-%d")
    week = (now - timedelta(hours=72)).strftime("%Y-%m-%d")

    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&start_date={week}&end_date={yesterday}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,precipitation,snowfall,snow_depth,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms"
    
    response = requests.get(url)
    if response.status_code != 200:
        return {"error": "Weather data fetch failed"}

    weather_data = response.json()

    lat_scaled = (lat - min_lat) / (max_lat - min_lat)
    lon_scaled = (lon - min_lon) / (max_lon - min_lon)

    time = pd.to_datetime(weather_data["hourly"]["time"])
    
    # Create time features
    month_sin = np.sin(2 * np.pi * time.month / 12)
    month_cos = np.cos(2 * np.pi * time.month / 12)
    hour_sin = np.sin(2 * np.pi * time.hour / 24)
    hour_cos = np.cos(2 * np.pi * time.hour / 24)

    df = pd.DataFrame({
        "temperature_2m": weather_data["hourly"]["temperature_2m"],
        "relative_humidity_2m": weather_data["hourly"]["relative_humidity_2m"],
        "precipitation": weather_data["hourly"]["precipitation"],
        "snowfall": weather_data["hourly"]["snowfall"],
        "snow_depth": weather_data["hourly"]["snow_depth"],
        "pressure_msl": weather_data["hourly"]["pressure_msl"],
        "cloud_cover": weather_data["hourly"]["cloud_cover"],
        "wind_speed_10m": weather_data["hourly"]["wind_speed_10m"],
        "wind_direction_10m": weather_data["hourly"]["wind_direction_10m"],
        "latitude": lat_scaled,
        "longitude": lon_scaled,
        "month_sin": month_sin,
        "month_cos": month_cos,
        "hour_sin": hour_sin,
        "hour_cos": hour_cos,
    })

    df.fillna(0, inplace=True)

    # Apply scaling
    minmax_features = ["relative_humidity_2m", "cloud_cover", "wind_direction_10m"]
    standard_features = ["temperature_2m", "pressure_msl", "wind_speed_10m", "precipitation", "snowfall", "snow_depth"]

    df[minmax_features] = scaler_minmax.transform(df[minmax_features])
    df[standard_features] = scaler_standard.transform(df[standard_features])

    # Prepare input for model
    X_weather = df[standard_features].values.reshape(1, 24, len(standard_features))
    X_geo = np.array([[lat_scaled, lon_scaled]])
    X_time = np.array([[month_sin.iloc[-1], month_cos.iloc[-1], hour_sin.iloc[-1], hour_cos.iloc[-1]]])

    # Make prediction
    prediction = model.predict([X_weather, X_geo, X_time])

    return {
        "lat": lat,
        "lon": lon,
        "prediction": prediction.tolist()
    }

# Vercel serverless handler
class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data)

        lat = float(data.get("lat", 65.0))
        lon = float(data.get("lon", 26.0))

        result = process_weather(lat, lon)

        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())
