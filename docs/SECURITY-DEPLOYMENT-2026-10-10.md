# Security update before HRM deployment

Next.js and its ESLint configuration are pinned to 16.3.8. The lockfile updates sharp to 0.35.5 and source-map-js to 1.2.2.

Before changes, source, environment, database and app image were backed up locally. The database dump restored successfully into isolated PostgreSQL 17.

Validation: production dependency audit reports zero vulnerabilities; 66 tests passed with no skips; SQL verification, lint, typechecking and production build passed in isolated validation. CI now checks production dependencies with npm audit --omit=dev.

The complete audit still reports five high findings in development-only ESLint dependencies (braces/micromatch/fast-glob and their parent packages). The suggested automatic fix downgrades eslint-config-next to an incompatible major version; it has not been applied. Do not claim that the complete audit is clean.

VPS deployment uses a separate Compose project, database volume and Nginx hostname. Do not start the Caddy production profile on a server already using Nginx on ports 80/443. Live data transfer, VPS restore validation, HTTPS and final browser checks remain deployment steps.