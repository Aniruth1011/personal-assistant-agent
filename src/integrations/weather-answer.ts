import { Temporal } from "@js-temporal/polyfill";
import { demoWeather } from "./weather.js";
export async function weatherAnswer(
  question: string,
  provider = demoWeather,
  now = new Date(),
) {
  const today = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO("America/Los_Angeles")
    .toPlainDate();
  const date = /\btomorrow\b/i.test(question) ? today.add({ days: 1 }) : today;
  const location =
    /\b(?:in|for)\s+([a-z][a-z .-]*?)(?=\s+(?:today|tomorrow|right now|this|next)|[?!,]|$)/i
      .exec(question)?.[1]
      ?.trim();
  if (
    location &&
    !/^(?:LA|Los Angeles|today|tomorrow|tonight|me)$/i.test(location)
  )
    return {
      status: "unsupported_location",
      text: "Weather is configured for Los Angeles only. No forecast for another city is being claimed.",
    };
  const w = await provider();
  if (w.status === "unavailable") return { status: w.status, text: w.reason };
  if (w.status === "forecast_only") {
    const current =
      /\b(right now|now|currently|tonight)\b/i.test(question) &&
      date.equals(today);
    const periods = current
      ? w.periods.slice(0, 1)
      : w.periods.filter((p) =>
          Temporal.Instant.from(p.startTime)
            .toZonedDateTimeISO("America/Los_Angeles")
            .toPlainDate()
            .equals(date),
        );
    if (!periods.length)
      return {
        status: "unavailable",
        text: `No verified Los Angeles forecast period covers ${date}. No estimate substituted.`,
      };
    const rain = periods.flatMap((p) =>
      p.probabilityOfPrecipitation.value === null
        ? []
        : [p.probabilityOfPrecipitation.value],
    );
    const recommendation = /\b(umbrella|rain)\b/i.test(question)
      ? rain.length
        ? Math.max(...rain) >= 40
          ? "Carrying an umbrella is sensible for this forecast period."
          : "The forecast shows a low rain probability for this period; I cannot confirm whether it is raining right now."
        : "Rain probability is unavailable; no umbrella recommendation can be verified."
      : "";
    return {
      status: w.status,
      text: `Los Angeles — ${date} (America/Los_Angeles). Forecast only; current observations unavailable.\n${periods.map((p) => `${p.name}: ${p.shortForecast}; ${p.temperatureC} °C; rain ${p.probabilityOfPrecipitation.value ?? "unknown"}%; valid ${p.startTime} to ${p.endTime}.`).join("\n")}\n${recommendation}\nSource: ${w.source}; generated ${w.generatedAt}.`,
      periods,
      source: w.source,
    };
  }
  const forecast = w.forecast.filter((f) => f.date === date.toString());
  return {
    status: w.status,
    text: `Los Angeles — ${date} (America/Los_Angeles). ${date.equals(today) ? `Current observation: ${w.temperatureC} °C; weather code ${w.weatherCode}; observed ${w.observedAt}.` : ""}\n${forecast.map((f) => `Forecast: ${f.lowC}–${f.highC} °C, rain probability ${f.rainProbability}%.`).join("\n")} Forecast probability is not confirmation of rain right now. Source: ${w.source}.`,
    forecast,
    source: w.source,
  };
}
