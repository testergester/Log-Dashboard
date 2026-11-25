# Teaching desk on Sites

Private published version of DashFirebase using the existing Firebase project.

The five Firebase web configuration values in firebase-web-config.json are public identifiers. Firebase Authentication and database rules authorize access. Never put service-account credentials here.

Build: node scripts/build.mjs
Verify: node scripts/verify.mjs

The Worker serves both pages and bundled assets and implements the authenticated timetable extraction endpoint. Set FIREBASE_PROJECT_ID and secret DEEPSEEK_API_KEY through Sites runtime settings. Google sign-in must authorize the Site hostname in Firebase. Image extraction limits are per Worker isolate, not a global distributed quota.

No teaching data is copied into this repository. The app reads and writes the original Firebase workspace. The publishing copy is isolated from the original DashFirebase source.
