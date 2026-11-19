# Files

- [Fake Google login](fake-google-login.md) - The development and test-only account chooser at /dev/fake-google that stands in for Google and signs people in through the same completeSignIn() rules as real Google.
- [Google sign-in flow](google-sign-in.md) - How a barnacle.ai user signs in with Google — OAuth 2.0 code flow with PKCE and a state cookie, the token and userinfo calls, the sign-in rules, first-admin creation and session creation.
- [Sessions and access control](sessions-and-access-control.md) - How signed-in state works — random session tokens stored as SHA-256 in Postgres, the crm_session cookie, the proxy cookie gate, requireUser/requireAdmin/assertAdminForAction, /auth/end, sign-out and safe return paths.
