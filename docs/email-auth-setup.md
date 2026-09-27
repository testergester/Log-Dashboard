# Passwordless email setup (Phase 3)

The dashboard uses Supabase `signInWithOtp({email, options: {emailRedirectTo, shouldCreateUser: true}})` with PKCE. No Google account, OAuth client, or password is needed. Workspace creation happens only after the signed-in teacher submits onboarding.

## Hosted setup

1. Apply the three versioned migrations from `supabase/migrations/` in timestamp order. Check migration history first; never reapply an already-applied schema. Use the CLI workflow in `supabase/README.md` for future changes.
2. In Authentication → Sign In / Providers, keep **Email** and **Allow new users to sign up** enabled. Keep email confirmation enabled. Google and other social providers are unnecessary.
3. Under Authentication → URL Configuration, use `http://127.0.0.1:4173/` as the development project's Site URL. Add these **exact** allowed redirects:
   - `http://127.0.0.1:4173/` (production-build preview)
   - `http://127.0.0.1:5173/` (development server)
4. For deployment, replace the Site URL with the deployed app URL and add its exact URL to the allow list. Do not use wildcard production redirects. Keep preview credentials/projects separate from production.
5. Keep the built-in **Confirm sign up** and **Magic link or OTP** email templates using `{{ .ConfirmationURL }}`. Supabase verifies the link and returns a PKCE `code` to the allow-listed app URL. This client exchanges that code, then verifies the user via Auth. Custom token-hash/server callback templates require a different handler and are not supported by this build.
6. Configure custom SMTP for teachers outside your Supabase project team. SMTP credentials belong only in Supabase's server-side settings. Do not put them in `.env.local`, public config, or the frontend.

The default Supabase sender is for testing, delivers only to team-member addresses, and is currently limited to two emails per hour. Do not add teachers as Supabase team members just to bypass that restriction. Use an SMTP provider instead. Confirm the current limits in the linked official documentation.

## Test checklist

- Request a link for an authorized test email; confirm the screen stays signed out and explains that the link must open in the same browser.
- Open the newest email link in the same browser and exact origin used to request it. An email app may otherwise open a different browser without the PKCE verifier.
- Complete display name and timezone (default `Asia/Tashkent`). Check that one workspace exists for the user.
- Reload: the session should restore without another email. Change the display name/timezone in Settings; sign out and sign back in. Returning users should not see onboarding again.
- Reopen a used/expired link: it should ask for a new link, reveal no private data, and not create another workspace.
- Test a second email after SMTP is configured. Account switching must clear the first account's rendered content immediately. The workspace data must remain isolated.
- A failed delivery request must show an error, not a sent-link or connected state. Repeated requests are also rate-limited by Supabase.
- Group creation and student import remain disabled in this phase.

Browser privacy settings must allow first-party storage for Supabase sessions and the PKCE verifier. Request a fresh link after clearing site storage or changing browsers. Links are single-use; mail scanners that consume links can also require requesting a replacement. Full cross-device link exchange is not part of this PKCE client.

## References

- [Supabase passwordless email authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [JavaScript signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp)
- [PKCE sessions](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Redirect allow lists](https://supabase.com/docs/guides/auth/redirect-urls)
- [Custom SMTP and default sender restrictions](https://supabase.com/docs/guides/auth/auth-smtp)
