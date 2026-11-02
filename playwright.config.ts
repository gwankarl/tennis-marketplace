import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      name: 'Backend API on port 3100',
      command: 'npm run dev --workspace=@tennis-xpress/backend',
      url: 'http://127.0.0.1:3100/api/v1/health',
      reuseExistingServer: false,
      env: {
        HOST: '127.0.0.1',
        PORT: '3100',
        // The health route does not connect to PostgreSQL; this only satisfies startup validation.
        DATABASE_URL: 'postgresql://127.0.0.1:5432/tennis_xpress_e2e_unused',
      },
    },
    {
      name: 'Frontend on port 4173',
      command:
        'npm run dev --workspace=@tennis-xpress/frontend -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      env: {
        API_BASE_URL: 'http://127.0.0.1:3100',
      },
    },
  ],
});
