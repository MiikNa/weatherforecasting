from flask import Flask, request, jsonify
import requests
import numpy as np
import tensorflow as tf
import os
from dotenv import load_dotenv

app = Flask(__name__)

load_dotenv()

model = tf.keras.models.load_model("weather_model.h5")

WEATHER_API_URL = "http://api.openweathermap.org/data/2.5/weather"

target_columns = ['temperature_2m_next', 'precipitation_next', 'relative_humidity_2m_next', 
                  'wind_speed_10m_next', 'snowfall_next']

def fetch_weather_data(city=None, lat=None, lon=None):
    params = {"appid": os.getenv("API_KEY"), "units": "metric"}

    if city:
        params["q"] = city
    elif lat is not None and lon is not None:
        params["lat"] = lat
        params["lon"] = lon
    else:
        return None

    response = requests.get(WEATHER_API_URL, params=params)

    if response.status_code == 200:
        data = response.json()
        return {
            "temperature": data["main"]["temp"],
            "humidity": data["main"]["humidity"],
            "pressure": data["main"]["pressure"],
            "wind_speed": data["wind"]["speed"]
        }
    else:
        return None

@app.route("/predict", methods=["GET"])
def predict_weather():
    """Predict weather conditions based on real-time data."""
    city = request.args.get("city")
    lat = request.args.get("lat")
    lon = request.args.get("lon")

    lat = float(lat) if lat else None
    lon = float(lon) if lon else None

    weather_data = fetch_weather_data(city=city, lat=lat, lon=lon)

    if weather_data is None:
        return jsonify({"error": "Invalid location or API issue"}), 404

    input_data = np.array([[weather_data["temperature"], 
                            weather_data["humidity"], 
                            weather_data["pressure"], 
                            weather_data["wind_speed"]]])

    predictions = model.predict(input_data)[0]  # Get first row of prediction

    prediction_dict = {target_columns[i]: float(predictions[i]) for i in range(len(target_columns))}

    return jsonify({
        "location": {"city": city, "latitude": lat, "longitude": lon},
        "current_weather": weather_data,
        "predictions": prediction_dict
    })

if __name__ == "__main__":
    app.run(debug=True)
