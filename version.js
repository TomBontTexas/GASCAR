/* GASCAR — single source of truth for the app version (see APP_CHANGES.md).
   Kept in its own tiny file (not inline in app.js) so startUpdateCheck() can
   re-load just this instead of the whole ~220KB app.js to check for a new
   deploy. `var`, not `const` -- this file gets re-injected via a fresh
   <script> tag on every check, and re-declaring a const throws. */
var LATEST_APP_VERSION = "0.02.04";
