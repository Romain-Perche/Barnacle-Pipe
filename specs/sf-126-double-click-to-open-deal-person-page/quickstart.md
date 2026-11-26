# Quickstart: SF-126

1. `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test; npm test && npm run typecheck`
2. Run the app with seed data (see README). Double-click a card on `/deals`, a row on `/deals/list`, `/people`,
   `/organisations` (outside the links): the record page opens; Back returns to the list with the same filters.
3. Single-click: drawer opens. Drag a card: it moves, no page. Double-click an organisation link in a row: that
   organisation's page. Delete a record in another tab, then double-click its row: the existing not-found page.
