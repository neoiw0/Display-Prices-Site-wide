# Display-Prices-Site-wide

 * Script Overview & Compliance Notes:
 *
 * This userscript enhances Neopets pages by displaying the latest market price
 * next to item images and names. It fetches pricing data from the itemdb.com.br
 * API and caches it locally using Tampermonkey's GM storage to minimize requests.
 *
 * Main Logic:
 * 1. On each page, it scans for item images (hosted at images.neopets.com/items/)
 *    and, on the Quick Stock page, for item names.
 * 2. For each discovered item, it looks up the price in the local cache.
 *    - If the cache is empty or stale (>7 days), it batches requests to the
 *      itemdb API (endpoint /api/v1/items/many) using image IDs.
 *    - Individual items can also be queried by name.
 * 3. A small price tooltip (absolute positioned) is added next to each item image.
 *    Hovering over the tooltip shows detailed info (rarity, last update, links to
 *    SW/SDB/TP/Auctions, etc.) and a manual refresh button.
 * 4. Certain images (scratchcards, potions, etc.) always display a bold green
 *    question mark because more than one items share the same image.
 * 5. The display can be toggled with Ctrl+B.
 *
 * Why it complies with Neopets rules:
 * - The script never simulates clicks, form submissions, or any automated actions.
 *   It only reads the DOM and adds visual overlays (purely cosmetic modification).
 * - It does not interfere with site functionality or game mechanics.
 * - It respects the “no automation” policy; all interactions require user intent.
 *
 * Why it is friendly to itemdb.com.br:
 * - Data is cached persistently with a 7-day staleness check.
 * - Requests are batched (many items per API call) to reduce the number of HTTP calls.
 * - No repeated polling; new queries only happen when new items appear on the page
 *   or when the user explicitly clicks “Refresh”.
 * - The script uses the public API respectfully and does not overwhelm the server.
  
   - <img width="736" height="402" alt="image" src="https://github.com/user-attachments/assets/5ad4d340-fb73-481e-839a-8ec858b996fa" />
   (Search healper icons in the image, not included in this script. You need to get that in DC)
