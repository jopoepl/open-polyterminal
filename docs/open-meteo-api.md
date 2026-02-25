# Open-Meteo API Documentation

## Metadata API - Model Run Times

### Endpoint Pattern
```
https://api.open-meteo.com/data/{model_id}/static/meta.json
```

### Response Fields

| Field | Description | Format |
|-------|-------------|--------|
| `last_run_initialisation_time` | Model initialization/reference time | Unix timestamp |
| `last_run_modification_time` | Data download/conversion completion time | Unix timestamp |
| `last_run_availability_time` | Time when data became accessible on API | Unix timestamp |
| `update_interval_seconds` | Typical interval between model updates | Seconds |
| `temporal_resolution_seconds` | Native temporal resolution of the model | Seconds |

### Model Metadata Endpoints

| Model | Model ID | Endpoint |
|-------|----------|----------|
| GFS 0.25 | `ncep_gfs025` | `https://api.open-meteo.com/data/ncep_gfs025/static/meta.json` |
| ICON Global | `dwd_icon` | `https://api.open-meteo.com/data/dwd_icon/static/meta.json` |
| ICON EU | `dwd_icon_eu` | `https://api.open-meteo.com/data/dwd_icon_eu/static/meta.json` |
| ECMWF IFS | `ecmwf_ifs04` | `https://api.open-meteo.com/data/ecmwf_ifs04/static/meta.json` |
| GEM Global | `cmc_gem_gdps` | `https://api.open-meteo.com/data/cmc_gem_gdps/static/meta.json` |
| JMA GSM | `jma_gsm` | `https://api.open-meteo.com/data/jma_gsm/static/meta.json` |
| UKMO Global | `ukmo_global_10km` | `https://api.open-meteo.com/data/ukmo_global_10km/static/meta.json` |
| ARPEGE Europe | `meteofrance_arpege_europe` | `https://api.open-meteo.com/data/meteofrance_arpege_europe/static/meta.json` |

---

## Forecast APIs

### Main Forecast API
```
https://api.open-meteo.com/v1/forecast
```

### Model-Specific APIs

| API | Endpoint | Models |
|-----|----------|--------|
| GFS/HRRR | `https://api.open-meteo.com/v1/gfs` | gfs_seamless, hrrr_conus, nbm_conus |
| DWD ICON | `https://api.open-meteo.com/v1/dwd-icon` | icon_seamless, icon_global, icon_eu, icon_d2 |
| ECMWF | `https://api.open-meteo.com/v1/ecmwf` | ecmwf_ifs, ecmwf_ifs025, ecmwf_aifs025 |
| Meteo-France | `https://api.open-meteo.com/v1/meteofrance` | arpege_seamless, arome_france |
| UKMO | `https://api.open-meteo.com/v1/ukmo` | ukmo_seamless, ukmo_global_10km |
| GEM | `https://api.open-meteo.com/v1/gem` | gem_seamless, gem_global, gem_regional |
| JMA | `https://api.open-meteo.com/v1/jma` | jma_seamless, jma_gsm, jma_msm |

### Previous Runs API
```
https://previous-runs-api.open-meteo.com/v1/forecast
```
Access historical forecast data from previous model runs.

### Historical Forecast API
```
https://historical-forecast-api.open-meteo.com/v1/forecast
```
Access archived forecast data from 2016-2022 onwards (varies by model).

---

## Historical Forecast API (Detailed)

### Overview
Access past weather forecasts for machine learning, forecast verification, and historical analysis. Identical parameters to the standard Forecast API but with extended historical date ranges.

**Key Feature: Full Hourly Resolution** - This API stores complete hourly forecasts from each model run, NOT just daily aggregates. You can retrieve what GFS/ICON/ECMWF/etc predicted for any specific hour going back to 2021-2022 (or 2016 for JMA).

### Base URL
```
https://historical-forecast-api.open-meteo.com/v1/forecast
```

### Data Availability by Model

| Model | Data Available From | Update Frequency |
|-------|---------------------|------------------|
| JMA GSM | 2016-01-01 | Every 6 hours |
| JMA MSM | 2016-01-01 | Every 3 hours |
| GFS | 2021 onwards | Every 6 hours |
| ICON Global | 2022 onwards | Every 6 hours |
| ICON EU | 2022 onwards | Every 3 hours |
| ECMWF IFS | 2022 onwards | Every 6 hours |
| HRRR | 2022 onwards | Every hour |
| GEM Global | 2022 onwards | Every 12 hours |
| UKMO | 2022 onwards | Every 6 hours |
| ARPEGE | 2022 onwards | Every 6 hours |
| MET Nordic | 2022 onwards | Every hour |

### Available Models (40+)

**Global Models:**
- `ecmwf_ifs`, `ecmwf_ifs025`, `ecmwf_aifs025`
- `gfs_seamless`, `gfs_global`, `gfs_graphcast`
- `icon_seamless`, `icon_global`
- `gem_seamless`, `gem_global`
- `jma_seamless`, `jma_gsm`
- `ukmo_seamless`, `ukmo_global_deterministic_10km`
- `arpege_seamless`, `arpege_world`

**Regional Models:**
- `icon_eu`, `icon_d2` (Europe)
- `hrrr_conus`, `nam_conus`, `nbm_conus` (US)
- `arome_france`, `arome_france_hd` (France)
- `jma_msm` (Japan)
- `gem_regional`, `gem_hrdps_continental` (Canada)
- `knmi_harmonie_arome_europe`, `knmi_harmonie_arome_netherlands` (Netherlands)
- `dmi_harmonie_arome_europe` (Denmark)
- `metno_seamless`, `metno_nordic` (Norway)
- `bom_access_global_ensemble` (Australia)
- `cma_grapes_global` (China)

### Key Parameters

```
?latitude=52.52
&longitude=13.41
&start_date=2024-01-01
&end_date=2024-01-31
&hourly=temperature_2m,precipitation
&models=gfs_seamless,ecmwf_ifs
```

| Parameter | Description |
|-----------|-------------|
| `start_date` | Start of historical range (YYYY-MM-DD) |
| `end_date` | End of historical range (YYYY-MM-DD) |
| `models` | Comma-separated list of model IDs |
| `hourly` | Hourly variables to fetch |
| `daily` | Daily variables to fetch |
| `forecast_hours` | Limit forecast hours per run |
| `past_hours` | Include hours before initialization |

### Hourly Variables (100+)

**Temperature & Humidity:**
- `temperature_2m`, `relative_humidity_2m`, `dewpoint_2m`
- `apparent_temperature` (feels like)
- Temperature at heights: `temperature_80m`, `temperature_120m`, `temperature_180m`

**Precipitation:**
- `precipitation`, `rain`, `showers`, `snowfall`
- `precipitation_probability`, `snow_depth`

**Wind:**
- `wind_speed_10m`, `wind_speed_80m`, `wind_speed_120m`, `wind_speed_180m`
- `wind_direction_10m`, `wind_direction_80m`, `wind_direction_120m`
- `wind_gusts_10m`

**Pressure & Clouds:**
- `pressure_msl`, `surface_pressure`
- `cloud_cover`, `cloud_cover_low`, `cloud_cover_mid`, `cloud_cover_high`
- `visibility`

**Solar Radiation:**
- `shortwave_radiation`, `direct_radiation`, `diffuse_radiation`
- `direct_normal_irradiance`, `global_tilted_irradiance`

**Atmospheric:**
- `cape` (Convective Available Potential Energy)
- `lifted_index`
- `convective_inhibition`

**Pressure Level Data (1000-30 hPa):**
- `temperature_{level}hPa`
- `geopotential_height_{level}hPa`
- `relative_humidity_{level}hPa`
- `wind_speed_{level}hPa`
- `wind_direction_{level}hPa`

### Daily Variables

- `temperature_2m_max`, `temperature_2m_min`, `temperature_2m_mean`
- `apparent_temperature_max`, `apparent_temperature_min`
- `precipitation_sum`, `precipitation_hours`, `precipitation_probability_max`
- `rain_sum`, `showers_sum`, `snowfall_sum`
- `sunrise`, `sunset`, `daylight_duration`, `sunshine_duration`
- `wind_speed_10m_max`, `wind_gusts_10m_max`, `wind_direction_10m_dominant`
- `shortwave_radiation_sum`, `et0_fao_evapotranspiration`
- `uv_index_max`, `uv_index_clear_sky_max`

### 15-Minutely Data

Available for Central Europe and North America only:
- `temperature_2m`, `relative_humidity_2m`
- `precipitation`, `rain`, `snowfall`
- `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`
- `shortwave_radiation`, `direct_radiation`, `diffuse_radiation`

Parameters: `minutely_15`, `forecast_minutely_15`, `past_minutely_15`

### Example API Calls

**Get historical GFS forecasts:**
```
https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=33.45&longitude=-112.07&start_date=2024-06-01&end_date=2024-06-30&hourly=temperature_2m,precipitation&daily=temperature_2m_max,temperature_2m_min&models=gfs_seamless&temperature_unit=fahrenheit&timezone=America/Phoenix
```

**Compare multiple models (hourly):**
```
https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&start_date=2024-01-01&end_date=2024-01-07&hourly=temperature_2m&models=ecmwf_ifs,gfs_seamless,icon_global&timezone=Europe/London
```

**Example Response (hourly data from multiple models):**
```json
{
  "hourly": {
    "time": ["2024-06-15T00:00", "2024-06-15T01:00", ...],
    "temperature_2m_gfs_seamless": [90.5, 87.2, 84.8, ...],
    "temperature_2m_ecmwf_ifs": [89.8, 86.9, 84.2, ...],
    "temperature_2m_icon_global": [91.0, 87.8, 85.1, ...]
  }
}
```
Each model returns 24 hourly values per day - full forecast resolution preserved.

### Use Cases

1. **Forecast Verification** - Compare past forecasts to actual observations
2. **ML Training** - Train models on historical forecast data
3. **Bias Correction** - Identify systematic model biases
4. **Ensemble Analysis** - Study forecast uncertainty over time

### Limitations

- Historical span is 2-5 years (shorter than reanalysis datasets)
- Models evolve over time, so older forecasts may differ from current model behavior
- 15-minutely data only available for Central Europe and North America
- Some pressure level variables unavailable for certain models

---

## Model Update Frequencies

| Model | Resolution | Update Frequency | Forecast Length |
|-------|------------|------------------|-----------------|
| GFS | 0.25 deg | Every 6 hours | 16 days |
| ICON Global | 11 km | Every 6 hours | 7.5 days |
| ICON EU | 7 km | Every 3 hours | 5 days |
| ECMWF IFS | 9 km | Every 6 hours | 10 days |
| GEM Global | 15 km | Every 12 hours | 10 days |
| JMA GSM | 55 km | Every 6 hours | 11 days |
| JMA MSM | 5 km | Every 3 hours | 4 days |
| UKMO Global | 10 km | Every 6 hours | 7 days |
| ARPEGE | 11-25 km | Every 6 hours | 4 days |

---

## Common Parameters

### Hourly Variables
- `temperature_2m` - Air temperature at 2m
- `relative_humidity_2m` - Relative humidity at 2m
- `dewpoint_2m` - Dew point at 2m
- `apparent_temperature` - Feels like temperature
- `precipitation` - Total precipitation
- `precipitation_probability` - Probability of precipitation
- `weather_code` - WMO weather code
- `cloud_cover` - Total cloud cover
- `wind_speed_10m` - Wind speed at 10m
- `wind_direction_10m` - Wind direction at 10m
- `wind_gusts_10m` - Wind gusts at 10m
- `visibility` - Visibility
- `pressure_msl` - Mean sea level pressure

### Daily Variables
- `temperature_2m_max` - Maximum temperature
- `temperature_2m_min` - Minimum temperature
- `precipitation_sum` - Total precipitation
- `precipitation_probability_max` - Max precipitation probability
- `sunrise` / `sunset` - Sun times
- `wind_speed_10m_max` - Maximum wind speed

### Options
- `temperature_unit=fahrenheit` or `celsius` (default)
- `wind_speed_unit=mph`, `kmh` (default), `ms`, `kn`
- `timezone=auto` or IANA timezone
- `forecast_days=1-16`
- `past_days=0-7`

---

## Notes

- Metadata API calls are NOT counted toward rate limits
- Wait 10 minutes after `last_run_availability_time` for data consistency
- `generationtime_ms` in responses is API processing time, NOT model run time
- Use metadata endpoints for accurate model timing information
