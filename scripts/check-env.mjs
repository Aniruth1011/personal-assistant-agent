import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const required = [
  "APPLYPILOT_ENV",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_USER_ID",
  "APPLYPILOT_TEST_GMAIL_ACCOUNT",
  "APPLYPILOT_TEST_CALENDAR_ID",
];
const errors = required
  .filter((name) => !process.env[name]?.trim())
  .map((name) => `Missing ${name}`);
if (
  process.env.APPLYPILOT_ENV &&
  !["development", "test", "production"].includes(process.env.APPLYPILOT_ENV)
)
  errors.push("Invalid APPLYPILOT_ENV");
if (
  process.env.TELEGRAM_ALLOWED_USER_ID &&
  !/^[1-9]\d*$/.test(process.env.TELEGRAM_ALLOWED_USER_ID)
)
  errors.push("Invalid TELEGRAM_ALLOWED_USER_ID");
if (
  process.env.APPLYPILOT_TEST_GMAIL_ACCOUNT &&
  !/^[^\s@]+@gmail\.com$/i.test(process.env.APPLYPILOT_TEST_GMAIL_ACCOUNT)
)
  errors.push("Invalid dedicated test Gmail account");
if (
  process.env.APPLYPILOT_TEST_CALENDAR_ID &&
  !/^[A-Za-z0-9._-]+@group\.calendar\.google\.com$/.test(
    process.env.APPLYPILOT_TEST_CALENDAR_ID,
  )
)
  errors.push("A dedicated secondary Google Calendar ID is required");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Local integration environment syntax is valid. Google credentials and the generated Gateway token are managed outside .env. Live provider authentication and cloud readiness require separate checks.",
  );
