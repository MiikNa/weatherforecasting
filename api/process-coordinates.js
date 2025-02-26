// This imports the required libraries for the serverless function
const tf = require('@tensorflow/tfjs-node');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Function to load model and scalers
async function loadModels() {
  try {
    const modelPath = path.join(process.cwd(), 'api', 'hybrid_weather_model');
    const model = await tf.loadLayersModel(`file://${modelPath}/model.json`);
    
    // Load scalers using fs
    const scalerMinMax = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'api', 'scaler_minmax.json'), 'utf8'));
    const scalerStandard = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'api', 'scaler_standard.json'), 'utf8'));
    const scalerCoordinates = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'api', 'scaler_coordinates.json'), 'utf8'));
    
    return { model, scalerMinMax, scalerStandard, scalerCoordinates };
  } catch (error) {
    console.error('Error loading models:', error);
    throw error;
  }
}

// Function to apply scaling similar to the original Python code
function applyScaling(data, scalerMinMax, scalerStandard) {
  const minmaxFeatures = ["relative_humidity_2m", "cloud_cover", "wind_direction_10m", "relative_humidity_2m_next"];
  const standardFeatures = ["temperature_2m", "pressure_msl", "wind_speed_10m", "precipitation", "snowfall", "snow_depth",
                          'temperature_2m_next','precipitation_next', 'wind_speed_10m_next', 'snowfall_next'];
  
  const result = {...data};
  
  // Apply standard scaling
  standardFeatures.forEach(feature => {
    if (feature in data) {
      result[feature] = (data[feature] - scalerStandard.mean[feature]) / scalerStandard.scale[feature];
    }
  });
  
  // Apply min-max scaling
  minmaxFeatures.forEach(feature => {
    if (feature in data) {
      result[feature] = (data[feature] - scalerMinMax.min[feature]) / (scalerMinMax.max[feature] - scalerMinMax.min[feature]);
    }
  });
  
  return result;
}

// Function to create input sequences for prediction
function createInputSequences(df, seqLength = 24) {
  const weatherFeatures = ['temperature_2m', 'precipitation', 'relative_humidity_2m', 'wind_speed_10m',
                        'snowfall', 'snow_depth', 'pressure_msl', 'cloud_cover', 'wind_direction_10m'];
  const geoFeatures = ['latitude', 'longitude'];
  const timeFeatures = ['month_sin', 'month_cos', 'day_sin', 'day_cos', 'hour_sin', 'hour_cos'];
  
  const allSequencesWeather = [];
  const allSequencesGeo = [];
  const allSequencesTime = [];
  
  for (let i = 0; i < df.length - seqLength; i++) {
    const weatherSeq = [];
    for (let j = i; j < i + seqLength; j++) {
      const weatherPoint = weatherFeatures.map(feature => df[j][feature]);
      weatherSeq.push(weatherPoint);
    }
    allSequencesWeather.push(weatherSeq);
    
    const geoPoint = geoFeatures.map(feature => df[i + seqLength - 1][feature]);
    const timePoint = timeFeatures.map(feature => df[i + seqLength - 1][feature]);
    
    allSequencesGeo.push(geoPoint);
    allSequencesTime.push(timePoint);
  }
  
  return {
    X_weather: tf.tensor3d(allSequencesWeather),
    X_geo: tf.tensor2d(allSequencesGeo),
    X_time: tf.tensor2d(allSequencesTime)
  };
}

// Function to inverse scaling predictions
function inverseScaling(predictions, scalerMinMax, scalerStandard) {
  const result = [];
  const features = [
    'temperature_2m_next',
    'precipitation_next',
    'relative_humidity_2m_next',
    'wind_speed_10m_next',
    'snowfall_next'
  ];
  
  for (let i = 0; i < predictions.length; i++) {
    const row = {};
    
    // Inverse standard scaling for temperature, precipitation, wind speed, snowfall
    row.temperature_2m_next = predictions[i][0] * scalerStandard.scale.temperature_2m_next + scalerStandard.mean.temperature_2m_next;
    row.precipitation_next = predictions[i][1] * scalerStandard.scale.precipitation_next + scalerStandard.mean.precipitation_next;
    row.wind_speed_10m_next = predictions[i][3] * scalerStandard.scale.wind_speed_10m_next + scalerStandard.mean.wind_speed_10m_next;
    row.snowfall_next = predictions[i][4] * scalerStandard.scale.snowfall_next + scalerStandard.mean.snowfall_next;
    
    // Inverse min-max scaling for humidity
    row.relative_humidity_2m_next = predictions[i][2] * (scalerMinMax.max.relative_humidity_2m_next - scalerMinMax.min.relative_humidity_2m_next) + scalerMinMax.min.relative_humidity_2m_next;
    
    result.push(row);
  }
  
  return result;
}

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lat, lon } = req.body;
    
    if (!lat || !lon) {
      return res.status(400).json({ error: 'Missing coordinates' });
    }

    // Get current date and previous dates
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const week = new Date(now);
    week.setDate(week.getDate() - 3);
    
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const weekStr = week.toISOString().split('T')[0];

    // Fetch weather data from Open-Meteo API
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${weekStr}&end_date=${yesterdayStr}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,precipitation,snowfall,snow_depth,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
    
    const response = await axios.get(url);
    const weatherData = response.data;

    // Load models and scalers
    const { model, scalerMinMax, scalerStandard, scalerCoordinates } = await loadModels();
    
    // Scale coordinates
    const [minLat, maxLat, minLon, maxLon] = scalerCoordinates;
    const latScaled = (lat - minLat) / (maxLat - minLat);
    const lonScaled = (lon - minLon) / (maxLon - minLon);
    
    // Process time features
    const timeArray = weatherData.hourly.time.map(t => new Date(t));
    
    const df = timeArray.map((time, idx) => {
      const month = time.getMonth() + 1;
      const day = time.getDate();
      const hour = time.getHours();
      const year = time.getFullYear();
      
      // Calculate days in month
      const daysInMonth = new Date(year, month, 0).getDate();
      
      // Calculate cyclic features
      const monthSin = Math.sin(2 * Math.PI * month / 12);
      const monthCos = Math.cos(2 * Math.PI * month / 12);
      const hourSin = Math.sin(2 * Math.PI * hour / 24);
      const hourCos = Math.cos(2 * Math.PI * hour / 24);
      const daySin = Math.sin(2 * Math.PI * day / daysInMonth);
      const dayCos = Math.cos(2 * Math.PI * day / daysInMonth);
      
      // Min/max years in dataset
      const minYear = Math.min(...timeArray.map(d => d.getFullYear()));
      const maxYear = Math.max(...timeArray.map(d => d.getFullYear()));
      
      const yearSin = Math.sin(2 * Math.PI * (year - minYear) / (maxYear - minYear || 1));
      const yearCos = Math.cos(2 * Math.PI * (year - minYear) / (maxYear - minYear || 1));
      
      return {
        temperature_2m: weatherData.hourly.temperature_2m[idx],
        relative_humidity_2m: weatherData.hourly.relative_humidity_2m[idx],
        precipitation: weatherData.hourly.precipitation[idx],
        snowfall: weatherData.hourly.snowfall[idx],
        snow_depth: weatherData.hourly.snow_depth[idx] || 0,
        pressure_msl: weatherData.hourly.pressure_msl[idx],
        cloud_cover: weatherData.hourly.cloud_cover[idx],
        wind_speed_10m: weatherData.hourly.wind_speed_10m[idx],
        wind_direction_10m: weatherData.hourly.wind_direction_10m[idx],
        latitude: latScaled,
        longitude: lonScaled,
        month_sin: monthSin,
        month_cos: monthCos,
        hour_sin: hourSin,
        hour_cos: hourCos,
        days_in_month: daysInMonth,
        day_sin: daySin,
        day_cos: dayCos,
        year_sin: yearSin,
        year_cos: yearCos,
        temperature_2m_next: 0,
        precipitation_next: 0,
        relative_humidity_2m_next: 0,
        wind_speed_10m_next: 0,
        snowfall_next: 0
      };
    });
    
    // Apply scaling
    const scaledDf = df.map(row => applyScaling(row, scalerMinMax, scalerStandard));
    
    // Create input sequences
    const { X_weather, X_geo, X_time } = createInputSequences(scaledDf, 24);
    
    // Make predictions
    const predictions = await model.predict([X_weather, X_geo, X_time]);
    const predictionArray = predictions.arraySync();
    
    // Inverse scaling
    const unscaledPredictions = inverseScaling(predictionArray, scalerMinMax, scalerStandard);
    
    // Format prediction list
    const predictionList = unscaledPredictions.map((pred, i) => ({
      hour: i,
      temperature_2m_next: parseFloat(pred.temperature_2m_next.toFixed(1)),
      precipitation_next: parseFloat(pred.precipitation_next.toFixed(1)),
      relative_humidity_2m_next: parseFloat(pred.relative_humidity_2m_next.toFixed(1)),
      wind_speed_10m_next: parseFloat(pred.wind_speed_10m_next.toFixed(1)),
      snowfall_next: parseFloat(pred.snowfall_next.toFixed(1))
    }));
    
    return res.status(200).json({
      message: "Coordinates received and processed",
      lat,
      lon,
      prediction: predictionList
    });
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: 'Error processing request', details: error.message });
  }
};