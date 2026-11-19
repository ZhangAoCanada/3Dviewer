import { test as base } from '@playwright/test';
export * from '@playwright/test';

/** Only the optional public release lookup is deterministic by default. */
export const test = base.extend<{ mockRelease: boolean }>({
  mockRelease: [true, { option: true }],
  context: async ({ context, mockRelease }, use) => {
    if (mockRelease && process.env.OV_LIVE_RELEASE !== '1') {
      await context.route('https://api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest', (route) =>
        route.fulfill({ json: { tag_name: 'v0.3.0' } }),
      );
    }
    await use(context);
  },
});
