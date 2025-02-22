from flask import Flask, request, jsonify
import requests
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import joblib
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

lat = 65.0
lon = 26.0

now = datetime.now()
today = now.strftime("%Y-%m-%d")
yesterday = (now - timedelta(hours=24)).strftime("%Y-%m-%d")

@app.route('/process-coordinates', methods=['POST'])
def process_coordinates():
    global lat, lon
    data = request.get_json()

    print("Received data:", data)
    lat = float(data['lat'])
    lon = float(data['lon'])
    print(f"Updated coordinates: lat={lat}, lon={lon}")

    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&start_date={yesterday}&end_date={today}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,precipitation,snowfall,snow_depth,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms"
    
    response = requests.get(url)
    if response.status_code == 200:
        weather_data = response.json()
        print("Weather data updated successfully")
        print("Weather API Response Keys:", weather_data["hourly"].keys())
    else:
        print("Failed to fetch weather data")
        return jsonify({"error": "Weather data fetch failed"}), 500
    df = pd.DataFrame({
        "time": pd.to_datetime(weather_data["hourly"]["time"]),
        "temperature": weather_data["hourly"]["temperature_2m"],
        "humidity": weather_data["hourly"]["relative_humidity_2m"],
        "precipitation": weather_data["hourly"]["precipitation"],
        "snowfall": weather_data["hourly"]["snowfall"],
        "snow_depth": weather_data["hourly"]["snow_depth"],
        "wind_speed": weather_data["hourly"]["wind_speed_10m"],
        "latitude": lat,
        "longitude": lon 
    })

    df['month_sin'] = np.sin(2 * np.pi * df['time'].dt.month / 12)
    df['month_cos'] = np.cos(2 * np.pi * df['time'].dt.month / 12)
    df['hour_sin'] = np.sin(2 * np.pi * df['time'].dt.hour / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['time'].dt.hour / 24)
    df['days_in_month'] = df['time'].dt.days_in_month
    df['day_sin'] = np.sin(2 * np.pi * df['time'].dt.day / df['days_in_month'])
    df['day_cos'] = np.cos(2 * np.pi * df['time'].dt.day / df['days_in_month'])

    df.drop(columns=['days_in_month', "time"], inplace=True)

    df["snow_depth"] = df["snow_depth"].fillna(0)

    df = apply_scaling(df)

    print(df)

    return jsonify({
        "message": "Coordinates received and processed",
        "lat": lat,
        "lon": lon
    })

def apply_scaling(new_data):
    """ Apply MinMax and Standard scaling to the weather data """
    scaler_minmax = joblib.load("scaler_minmax.pkl")
    scaler_standard = joblib.load("scaler_standard.pkl")

    minmax_features = ["relative_humidity_2m", "cloud_cover", "wind_direction_10m"]
    standard_features = ["temperature", "wind_speed", "precipitation", "snowfall", "snow_depth"]

    existing_minmax = [col for col in minmax_features if col in new_data.columns]
    existing_standard = [col for col in standard_features if col in new_data.columns]

    if existing_minmax:
        new_data[existing_minmax] = scaler_minmax.transform(new_data[existing_minmax])
    
    if existing_standard:
        new_data[existing_standard] = scaler_standard.transform(new_data[existing_standard])

    return new_data

if __name__ == '__main__':
    app.run(debug=True, port=5000)
