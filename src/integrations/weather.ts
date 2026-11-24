import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
const temperature = z.number().min(-100).max(70);
const ResponseSchema = z.object({
  current: z.object({
    time: z.number().finite(),
    temperature_2m: temperature,
    weather_code: z.number().int().min(0).max(99),
  }),
  current_units: z.object({ temperature_2m: z.literal("°C") }),
  daily: z.object({
    time: z.array(z.number()),
    temperature_2m_max: z.array(temperature),
    temperature_2m_min: z.array(temperature),
    precipitation_probability_max: z.array(z.number().min(0).max(100)),
    weather_code: z.array(z.number().int().min(0).max(99)),
  }),
  daily_units: z.object({
    temperature_2m_max: z.literal("°C"),
    temperature_2m_min: z.literal("°C"),
    precipitation_probability_max: z.literal("%"),
  }),
});
export async function demoWeather(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  try {
    const response = await fetcher(
      "https://api.open-meteo.com/v1/forecast?latitude=34.05&longitude=-118.24&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=2&timeformat=unixtime&timezone=America%2FLos_Angeles",
      { signal: AbortSignal.timeout(8000), redirect: "error" },
    );
    if (!response.ok) throw Error("WEATHER_HTTP");
    const body = ResponseSchema.parse(await response.json());
    if (Math.abs(now - body.current.time * 1000) > 2 * 3600000)
      throw Error("WEATHER_STALE");
    const day = (ms: number) =>
      Temporal.Instant.fromEpochMilliseconds(ms)
        .toZonedDateTimeISO("America/Los_Angeles")
        .toPlainDate()
        .toString();
    const forecast = body.daily.time.map((time, i) => ({
      date: day(time * 1000),
      highC: body.daily.temperature_2m_max[i],
      lowC: body.daily.temperature_2m_min[i],
      rainProbability: body.daily.precipitation_probability_max[i],
      weatherCode: body.daily.weather_code[i],
    }));
    if (
      forecast.length !== 2 ||
      new Set(forecast.map((f) => f.date)).size !== 2 ||
      forecast[0]!.date !== day(now) ||
      forecast[1]!.date !==
        Temporal.PlainDate.from(day(now)).add({ days: 1 }).toString() ||
      forecast.some(
        (f) =>
          Object.values(f).some((v) => v === undefined) || f.lowC! > f.highC!,
      )
    )
      throw Error("FORECAST_INVALID");
    return {
      status: "success" as const,
      city: "Los Angeles (fixed demo city)",
      temperatureC: body.current.temperature_2m,
      weatherCode: body.current.weather_code,
      observedAt: new Date(body.current.time * 1000).toISOString(),
      forecast,
      source: "https://open-meteo.com/",
    };
  } catch {
    return nwsWeather(fetcher, now);
  }
}

/** Public NWS fallback; forecasts are explicitly distinguished from observations. */
export async function nwsWeather(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  const get = async (url: string) => {
    const response = await fetcher(url, {
      headers: {
        "User-Agent": "ApplyPilot-CSCI599-Synthetic-Demo",
        Accept: "application/geo+json",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) throw Error("NWS_HTTP");
    return response.json();
  };
  try {
    const point = z
      .object({
        properties: z.object({
          forecast: z
            .string()
            .regex(
              /^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d{1,4},\d{1,4}\/forecast$/,
            ),
        }),
      })
      .parse(await get("https://api.weather.gov/points/34.05,-118.24"));
    const result = z
      .object({
        properties: z.object({
          generatedAt: z.string().datetime({ offset: true }),
          periods: z
            .array(
              z.object({
                name: z.string().min(1).max(80),
                startTime: z.string().datetime({ offset: true }),
                endTime: z.string().datetime({ offset: true }),
                temperature: z.number().finite(),
                temperatureUnit: z.enum(["C", "F"]),
                shortForecast: z.string().min(1).max(200),
                probabilityOfPrecipitation: z.object({
                  unitCode: z.literal("wmoUnit:percent"),
                  value: z.number().min(0).max(100).nullable(),
                }),
              }),
            )
            .min(3),
        }),
      })
      .parse(await get(point.properties.forecast));
    if (
      Math.abs(now - Date.parse(result.properties.generatedAt)) >
      24 * 3600000
    )
      throw Error("NWS_STALE");
    const periods = result.properties.periods
      .filter((p) => Date.parse(p.endTime) > now)
      .slice(0, 3)
      .map((p) => ({
        ...p,
        temperatureC:
          Math.round(
            (p.temperatureUnit === "F"
              ? ((p.temperature - 32) * 5) / 9
              : p.temperature) * 10,
          ) / 10,
      }));
    if (
      periods.length !== 3 ||
      Date.parse(periods[0]!.startTime) > now ||
      periods.some(
        (p, i) =>
          Date.parse(p.startTime) >= Date.parse(p.endTime) ||
          p.temperatureC < -100 ||
          p.temperatureC > 70 ||
          (i > 0 && p.startTime !== periods[i - 1]!.endTime),
      )
    )
      throw Error("NWS_PERIOD_INVALID");
    return {
      status: "forecast_only" as const,
      city: "Los Angeles (fixed demo city)",
      generatedAt: result.properties.generatedAt,
      periods,
      source: point.properties.forecast,
    };
  } catch {
    return {
      status: "unavailable" as const,
      reason:
        "Weather forecast unavailable, invalid or stale; no estimate substituted.",
    };
  }
}
