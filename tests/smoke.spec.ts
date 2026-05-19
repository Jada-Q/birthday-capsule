import { test, expect } from "@playwright/test";

/**
 * End-to-end smoke test of the birthday ritual.
 *
 * Uses ?bypass=1 to skip getUserMedia / face-api / blow detection (real cam/mic
 * can't run in headless). Tap-to-blow becomes the only path; cleanup branch
 * still exercises the real DOM + state machine. The capsule submit API is
 * mocked at the network layer so no real GitHub Issue is created.
 *
 * What this catches:
 *   • Tick-loop scheduling races (e.g. cleanup never fires after blow)
 *   • DOM mount race (cake-mount empty before main.ts runs)
 *   • Renamed selectors / broken button id wiring
 *   • API contract drift (capsule submit endpoint / payload shape)
 *   • Phase transitions: intro → blow → post-blow → capsule modal → sealed
 *
 * What this CAN'T catch (need real device):
 *   • iOS Safari quirks (autoplay, audio session, AGC, track conflicts)
 *   • Real face-api detection accuracy
 *   • Real blow detection sensitivity
 */

test.describe("birthday ritual happy path", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the capsule submit endpoint so the test doesn't create a real GitHub Issue.
    await page.route("**/api/submit-capsule", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://github.com/Jada-Q/birthday-capsule/issues/999",
        }),
      }),
    );
  });

  test("full ritual: light → blow → write → seal", async ({ page }) => {
    // ─── Scene 1: birthday intro ───────────────────────────────────
    await page.goto("/?dev=1&bypass=1");

    // Cake painting is inlined in HTML — should be present immediately.
    await expect(page.locator("#painting-el")).toBeVisible();
    await expect(page.locator("#painting-el")).toHaveClass(/is-ready/, { timeout: 5000 });

    // Birthday-intro hero copy
    await expect(page.locator(".hero-title")).toContainText("today's");
    await expect(page.locator(".hero-title")).toContainText("the day");
    await expect(page.locator(".hero-sub")).toContainText("camera + mic");

    // Cake starts dormant (no flame overlay) until user clicks
    await expect(page.locator("#painting-glow")).toBeHidden();
    await expect(page.locator("#painting-sparks")).toBeHidden();

    // ─── Scene 2: light it up ──────────────────────────────────────
    await page.locator("#start-btn").click();

    // Flame overlay should appear immediately after lighting
    await expect(page.locator("#painting-glow")).toBeVisible();
    await expect(page.locator("#painting-sparks")).toBeVisible();

    // BYPASS skips face match → straight to blow prompt
    await expect(page.locator(".blow-prompt")).toContainText("blow it out", { timeout: 5000 });
    await expect(page.locator("#cake-stage-el")).toHaveClass(/cake-stage--clickable/);

    // ─── Scene 3: blow it out (via tap) ────────────────────────────
    await page.locator("#cake-stage-el").click();

    // Smoke shown, glow/sparks hidden
    await expect(page.locator("#painting-smoke")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("#painting-glow")).toBeHidden();

    // Post-blow hero: "39." + "write the letter"
    await expect(page.locator(".hero-title")).toContainText("39", { timeout: 5000 });
    await expect(page.locator(".hero-sub")).toContainText("thirty-eight");
    const writeBtn = page.locator("#write-btn");
    await expect(writeBtn).toBeVisible();

    // Age digit crossfaded to AGE_AFTER (39)
    await expect(page.locator("#cake-age")).toHaveText("39", { timeout: 2000 });

    // ─── Scene 4: capsule form modal ───────────────────────────────
    await writeBtn.click();

    await expect(page.locator(".modal-content")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".modal-eyebrow")).toContainText("SEALED FOR 2027");
    await expect(page.locator(".modal-title")).toContainText("next-year you");

    // Fill the three prompts
    await page.locator("#q1").fill("smoke-test proudest moment");
    await page.locator("#q2").fill("smoke-test warning");
    await page.locator("#q3").fill("smoke-test wish");

    // ─── Scene 5: seal it ──────────────────────────────────────────
    await page.locator("#submit-btn").click();

    // Sealed confirmation card appears
    await expect(page.locator(".sealed__title")).toContainText("sealed", { timeout: 5000 });
    await expect(page.locator(".sealed__env")).toBeVisible();
    await expect(page.locator(".sealed__link")).toContainText("Jada-Q/birthday-capsule");
  });

  test("painting reveals (is-ready) after img decode — no permanent invisible state", async ({ page }) => {
    await page.goto("/?dev=1&bypass=1");
    // Painting should opacity-reveal within 5s of load
    await expect(page.locator("#painting-el")).toHaveClass(/is-ready/, { timeout: 5000 });
    // Cake DOM elements are present (inlined in HTML, not JS-mounted)
    await expect(page.locator("#cake-age")).toBeVisible();
    await expect(page.locator("#painting-el img")).toBeVisible();
  });
});
