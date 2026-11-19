# Files

- [Configuration and environments](configuration-and-environments.md) - The environment variables the CRM reads, how APP_ENV and VERCEL_ENV switch the fake login, fake data and sign-in on or off, and how local, test, preview and production runs differ.
- [Migrations and fake data](migrations-and-seeding.md) - How npm run db:migrate applies migrations/*.sql safely through Supabase's pooler, when it runs (never at app start), and how npm run db:seed loads idempotent fake data through the seeder registry.
