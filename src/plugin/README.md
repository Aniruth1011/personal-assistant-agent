# Personal assistant plugin

Registers email/calendar/report readers, `list_todos`, durability checkpoints and model-routing hooks. Authenticated Telegram commands handle task changes, preferences and approved email sends. No browser execution or form server is loaded.

Configuration: `assistantStatePath` on local transactional disk, `testGmailAccount`, `testCalendarId`, and optional verified `cloudModel`. Runtime source is `src/index.ts` in this package. Build with `npm run plugin:build`; the root source entry is not the Gateway entry point.

Four workspace skills: calendar, email, web-search, todo. Skill instructions never substitute for code-enforced approval and permissions. Only synthetic data and dedicated accounts are permitted.
