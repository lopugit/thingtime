/** Enter Builder through the same control available to the user. */
export async function enableCurrentPageBuilder(page) {
  const toggle = page.getByRole('button', { name: 'Builder on current page', exact: true });
  const openMenu = page.getByRole('button', { name: 'Open menu', exact: true });
  await toggle.or(openMenu).first().waitFor({ timeout: 60000 });
  const openedMenu = !await toggle.isVisible();
  if (openedMenu) await openMenu.click();
  await toggle.waitFor();
  if (await toggle.getAttribute('aria-pressed') !== 'true') {
    await toggle.press('Enter');
  } else if (openedMenu) {
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  }
}
