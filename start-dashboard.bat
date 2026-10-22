@echo off
REM Starts the ContextDiet Web Dashboard + Proxy Gateway on port 4310.
REM Requires Node.js >= 22.6 on your PATH (https://nodejs.org).
node --no-warnings --experimental-strip-types "%~dp0src\cli.ts" serve 4310
