---
name: fast-tests
description: How to write tests that are fast and reliable, in any language and test framework - independent tests that can run in parallel, expensive setup built once, no waiting, and only the tests of the change while you work. Use when you write or change tests.
---
# Fast tests

A test suite runs many times: in every Build session, in Checks, before every update. A slow suite slows
every task, and a test that depends on another test fails at random. These rules keep tests fast and
reliable in any stack. They never justify dropping a test: a test that is slow because it checks
something real stays.

## 1. Make each test independent

Tests that share nothing can run at the same time, in any order.

- Give each test its own resources: a temporary folder, a free port (ask the system for port 0), its own
  database or a transaction rolled back after the test.
- Never write into the repo. Never use a fixed port, a fixed path in a shared folder or a fixed file name.
- Do not change what the whole process shares: environment variables, the current folder, global
  variables, the clock. Use the framework's tools that undo the change when the test ends (a mock or
  patch scoped to the test, a fake clock). Some runners (Go, Rust) run tests as threads of one process:
  there this rule is required.
- A test never relies on another test having run first.

## 2. Use the parallel run the framework already has

Most frameworks run tests in parallel: Jest, Vitest and Playwright (by default), Go (packages), pytest
(`-n`, pytest-xdist), Gradle (`maxParallelForks`), Rails (`parallelize`), cargo (threads). Write tests that
work with it (rule 1). Do not add a dependency or a new runner only to make the tests faster, unless the
plan asks for it.

## 3. Build expensive setup once when tests only read it

When several tests read the same expensive data (a seeded database, a built app, a git repo, a large
file), build it once per file or class (`beforeAll`, `setUpClass`, `TestMain`, a module-scoped fixture).
A test that changes the data gets its own copy.

## 4. Never wait for time to pass

- No `sleep` to wait for something. Wait for the thing itself: a ready line, a callback, or a condition
  checked in a loop with a short interval and a timeout.
- Code that depends on the time gets the framework's fake clock (Jest fake timers, freezegun, an
  injected clock), never a real wait.
- A server started in a test stops at once: in Python, `serve_forever(poll_interval=0.01)`; otherwise
  its own close method.

## 5. While you work, run only the tests of your change

Run the tests you write and the existing tests of the code you change: one file, one class or one test,
with the framework's filter (`python3 -m unittest test_x.Class`, `npx vitest run <path>`,
`pytest <path>::<test>`, `go test ./<pkg> -run <Name>`). The full suite runs at the end: in the factory,
after your Build session, and it sends you every failure.

Outside services, fakes and the test recipe: `.claude/skills/test-recipe/SKILL.md`.
