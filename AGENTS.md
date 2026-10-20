# Pokadrovo project workflow

The owner has authorized routine website changes to be committed to `krest0208/pokadrovo-web`, branch `main`, and deployed to **pokadrovo.ru**, VPS **138.16.185.3**, without asking for confirmation on every update.

- Finish and verify each requested change, then publish only that task's files through the connected GitHub tools. The local checkout contains unrelated historical changes: never commit all dirty files blindly.
- Never commit credentials, private databases, user uploads, production environment files or authentication cookies.
- Preserve concurrent changes: build the GitHub tree on the current remote head and update the ref with an expected-SHA guard.
- The VPS pull agent installs only the current `main` commit after the `Check Pokadrovo Web` push workflow succeeds and its isolated VPS build passes. Report the actual deployed SHA; a GitHub commit alone does not prove deployment.
- This standing authorization does not override platform permission checks, account security requirements or a rejected tool action. Do not bypass restrictions or recover passwords from a console.
- Do not change other domains, DNS, billing, owner credentials or unrelated applications as part of routine publication.

- Keep the public feature list in `server/site-ideas.mjs` in sync when editing or AI capabilities change. It supplies the hourly site agent with product context for suggestions.
