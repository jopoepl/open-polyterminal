interface SummaryMetrics {
  mae: number
  rmse: number
  bias: number
  accuracyPct: number
}

function round(value: number, digits: number = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function computeMetrics(errors: number[], accuracyThreshold: number): SummaryMetrics | null {
  if (errors.length === 0) return null

  const absErrors = errors.map(Math.abs)
  const mae = absErrors.reduce((acc, value) => acc + value, 0) / errors.length
  const rmse = Math.sqrt(errors.reduce((acc, value) => acc + value * value, 0) / errors.length)
  const bias = errors.reduce((acc, value) => acc + value, 0) / errors.length
  const withinThreshold = absErrors.filter(value => value <= accuracyThreshold).length
  const accuracyPct = (withinThreshold / errors.length) * 100

  return {
    mae: round(mae),
    rmse: round(rmse),
    bias: round(bias),
    accuracyPct: round(accuracyPct, 1),
  }
}

export function celsiusToFahrenheit(celsius: number): number {
  return round((celsius * 9 / 5) + 32, 1)
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return round((fahrenheit - 32) * 5 / 9, 1)
}

