import type { Page } from '@playwright/test';

// Graded answers now advance with Good (or Again after an error); exploration retains Next.
export function workspaceNext(page: Page) {
  return page.locator('.workspace-next, .review-ratings button[data-rating="3"]:not(:disabled), .review-ratings:has(button[data-rating="3"]:disabled) button[data-rating="1"]');
}
