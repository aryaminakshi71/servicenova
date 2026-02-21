import { expect, test } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/servicenova-ai/);
});

test("health endpoint works", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.ok).toBe(true);
  expect(data.app).toBe("servicenova-ai");
});
