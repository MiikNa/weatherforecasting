from flask import Flask, request, jsonify
import requests
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import joblib
from flask_cors import CORS
import tensorflow as tf

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

model = tf.keras.models.load_model("./api/hybrid_weather_model.h5")

lat = 65.0
lon = 26.0

now = datetime.now()
yesterday = (now - timedelta(hours=24)).strftime("%Y-%m-%d")
week = (now - timedelta(hours=72)).strftime("%Y-%m-%d")

def inverse_scaling(predictions):
    scaler_minmax = joblib.load("./api/scaler_minmax.pkl")
    scaler_standard = joblib.load("./api/scaler_standard.pkl")
    
    pred_df = pd.DataFrame(predictions, columns=[
        'temperature_2m_next',
        'precipitation_next',
        'relative_humidity_2m_next',
        'wind_speed_10m_next',
        'snowfall_next'
    ])
    
    standard_features_all = ["temperature_2m", "pressure_msl", "wind_speed_10m",
                      "precipitation", "snowfall", "snow_depth",
                      'temperature_2m_next','precipitation_next',
                      'wind_speed_10m_next', 'snowfall_next']
    
    minmax_features_all = ["relative_humidity_2m", "cloud_cover",
                    "wind_direction_10m", "relative_humidity_2m_next"]
    
    standard_df = pd.DataFrame(0, index=range(len(pred_df)), columns=standard_features_all)
    minmax_df = pd.DataFrame(0, index=range(len(pred_df)), columns=minmax_features_all)
    
    standard_df['temperature_2m_next'] = pred_df['temperature_2m_next']
    standard_df['precipitation_next'] = pred_df['precipitation_next']
    standard_df['wind_speed_10m_next'] = pred_df['wind_speed_10m_next']
    standard_df['snowfall_next'] = pred_df['snowfall_next']
    
    minmax_df['relative_humidity_2m_next'] = pred_df['relative_humidity_2m_next']
    
    standard_df_unscaled = scaler_standard.inverse_transform(standard_df)
    minmax_df_unscaled = scaler_minmax.inverse_transform(minmax_df)
    
    result = np.zeros_like(predictions)
    result[:, 0] = standard_df_unscaled[:, standard_features_all.index('temperature_2m_next')]
    result[:, 1] = standard_df_unscaled[:, standard_features_all.index('precipitation_next')]
    result[:, 2] = minmax_df_unscaled[:, minmax_features_all.index('relative_humidity_2m_next')]
    result[:, 3] = standard_df_unscaled[:, standard_features_all.index('wind_speed_10m_next')]
    result[:, 4] = standard_df_unscaled[:, standard_features_all.index('snowfall_next')]
    
    return result

@app.route('/process-coordinates', methods=['POST'])
def process_coordinates():
    global lat, lon
    data = request.get_json()

    print("Received data:", data)
    lat = float(data['lat'])
    lon = float(data['lon'])
    print(f"Updated coordinates: lat={lat}, lon={lon}")

    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&start_date={week}&end_date={yesterday}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,precipitation,snowfall,snow_depth,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms"
    
    response = requests.get(url)
    if response.status_code == 200:
        weather_data = response.json()
        print("Weather data updated successfully")
        print("Weather API Response Keys:", weather_data["hourly"].keys())
    else:
        print("Failed to fetch weather data")
        return jsonify({"error": "Weather data fetch failed"}), 500

    min_lat, max_lat, min_lon, max_lon = joblib.load("./api/scaler_coordinates.pkl")
    lat_scaled = (lat - min_lat) / (max_lat - min_lat)
    lon_scaled = (lon - min_lon) / (max_lon - min_lon)
    
    time = pd.to_datetime(weather_data["hourly"]["time"])
    time_series = pd.Series(time)

    month_sin = np.sin(2 * np.pi * time_series.dt.month / 12)
    month_cos = np.cos(2 * np.pi * time_series.dt.month / 12)
    hour_sin = np.sin(2 * np.pi * time_series.dt.hour / 24)
    hour_cos = np.cos(2 * np.pi * time_series.dt.hour / 24)
    days_in_month = time_series.dt.days_in_month
    day_sin = np.sin(2 * np.pi * time_series.dt.day / days_in_month)
    day_cos = np.cos(2 * np.pi * time_series.dt.day / days_in_month)
    year_sin = np.sin(2 * np.pi * (time_series.dt.year - time_series.dt.year.min()) / (time_series.dt.year.max() - time_series.dt.year.min()))
    year_cos = np.cos(2 * np.pi * (time_series.dt.year - time_series.dt.year.min()) / (time_series.dt.year.max() - time_series.dt.year.min()))

    df = pd.DataFrame({
        "time": pd.to_datetime(weather_data["hourly"]["time"]),
        "temperature_2m": weather_data["hourly"]["temperature_2m"],
        "relative_humidity_2m": weather_data["hourly"]["relative_humidity_2m"],
        "precipitation": weather_data["hourly"]["precipitation"],
        "snowfall": weather_data["hourly"]["snowfall"],
        "snow_depth": weather_data["hourly"]["snow_depth"],
        "pressure_msl":weather_data["hourly"]["pressure_msl"],
        "cloud_cover":weather_data["hourly"]["cloud_cover"],
        "wind_speed_10m": weather_data["hourly"]["wind_speed_10m"],
        "wind_direction_10m": weather_data["hourly"]["wind_direction_10m"],
        "latitude": lat_scaled,
        "longitude": lon_scaled,
        "month_sin" : month_sin,
        'month_cos': month_cos,
        'hour_sin': hour_sin,
        'hour_cos': hour_cos,
        'days_in_month': days_in_month,
        'day_sin': day_sin,
        'day_cos': day_cos,
        'year_sin': year_sin,
        'year_cos': year_cos,
        'temperature_2m_next' : 0, 
        'precipitation_next': 0, 
        'relative_humidity_2m_next': 0, 
        'wind_speed_10m_next': 0, 
        'snowfall_next': 0
    })

    df.drop(columns=['days_in_month', "time"], inplace=True)
    df["snow_depth"] = df["snow_depth"].fillna(0)

    df = apply_scaling(df)

    X_weather, X_geo, X_time = create_input_sequences_for_prediction(df, seq_length=24)

    raw_prediction = model.predict([X_weather, X_geo, X_time])
    
    unscaled_predictions = inverse_scaling(raw_prediction)

    prediction_list = []
    for i in range(24):
        prediction_list.append({
            "hour": i,
            "temperature_2m_next": float(round(unscaled_predictions[i][0], 1)),
            "precipitation_next": float(round(unscaled_predictions[i][1], 1)),
            "relative_humidity_2m_next": float(round(unscaled_predictions[i][2], 1)),
            "wind_speed_10m_next": float(round(unscaled_predictions[i][3], 1)),
            "snowfall_next": float(round(unscaled_predictions[i][4], 1))
        })

    print("Model Prediction (unscaled):", prediction_list)

    return jsonify({
        "message": "Coordinates received and processed",
        "lat": lat,
        "lon": lon,
        "prediction": prediction_list
    })

def apply_scaling(new_data):
    scaler_minmax = joblib.load("./api/scaler_minmax.pkl")
    scaler_standard = joblib.load("./api/scaler_standard.pkl")

    minmax_features = ["relative_humidity_2m", "cloud_cover",
                       "wind_direction_10m","relative_humidity_2m_next"]
    
    standard_features = ["temperature_2m", "pressure_msl", "wind_speed_10m",
                         "precipitation", "snowfall", "snow_depth",
                         'temperature_2m_next','precipitation_next',
                         'wind_speed_10m_next', 'snowfall_next']

    existing_minmax = [col for col in minmax_features if col in new_data.columns]
    existing_standard = [col for col in standard_features if col in new_data.columns]

    if existing_minmax:
        new_data[existing_minmax] = scaler_minmax.transform(new_data[existing_minmax])
    
    if existing_standard:
        new_data[existing_standard] = scaler_standard.transform(new_data[existing_standard])

    return new_data

def create_input_sequences_for_prediction(df, seq_length=24):
    all_sequences_weather = []
    all_sequences_geo = []
    all_sequences_time = []
    
    weather_features = ['temperature_2m', 'precipitation', 'relative_humidity_2m', 'wind_speed_10m',
                    'snowfall', 'snow_depth', 'pressure_msl', 'cloud_cover', 'wind_direction_10m']
    geo_features = ['latitude', 'longitude']
    time_features = ['month_sin', 'month_cos', 'day_sin', 'day_cos', 'hour_sin', 'hour_cos']
    
    for i in range(len(df) - seq_length):
        all_sequences_weather.append(df[weather_features].iloc[i:i+seq_length].values)
        all_sequences_geo.append(df[geo_features].iloc[i+seq_length-1].values)
        all_sequences_time.append(df[time_features].iloc[i+seq_length-1].values)
    
    X_weather = np.array(all_sequences_weather)
    X_geo = np.array(all_sequences_geo)
    X_time = np.array(all_sequences_time)
    
    return X_weather, X_geo, X_time


if __name__ == '__main__':
    app.run(debug=True, port=5000)