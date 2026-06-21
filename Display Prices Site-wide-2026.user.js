// ==UserScript==
// @name         Display Prices Site-wide
// @namespace    http://tampermonkey.net/
// @version      2026
// @description  Display item prices site-wide on Neopets
// @author       PoPoBori
// @match        *://www.neopets.com/*
// @match        *://neopets.com/*
// @match        *://*.neopets.com/*
// @exclude      *://www.neopets.com/dome/arena*
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      itemdb.com.br
// @grant        GM_xmlhttpRequest
// ==/UserScript==


/*
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
 */

// List of image IDs that do not correspond to a fixed market price because more than one items share the same image..
// These will show a bold green "?" instead of a price.
const useQuestionMarkForTheseImages = [
    'scratchcard1','scratchcard2','scratchcard3','scratchcard4','scratchcard5','scratchcard6',
    'scratchcard7','scratchcard8','scratchcard9','scratchcard10','scratchcard11','scratchcard12',
    'goldtradingcardback','blacktradingcardback','greentradingcardback','bluetradingcardback',
    'redtradingcardback','pinktradingcardback','holotradingcardback','potion33','snow_applechiapop',
    'mall_ppph_singledie','om_tomato_peppers1','mall_ppph_snowpetpet','gif_ki_mysterioustreasurechest',
    'bd_fire_03','potion0','potion1','potion2','potion3','potion4','potion5','potion6','potion7',
    'potion8','potion9','potion10','potion11','potion12','potion13','potion14','potion15','potion16',
    'potion17','potion18','potion19','potion20','potion21','potion22','potion23','potion24','potion25',
    'potion26','potion27','potion28','potion29','potion30','potion31','potion32','potion33','potion34',
    'potion35','potion36','potion37','potion38','potion39','potion40','toy_kacheekblue',
    // 'exampleImageID' entries are placeholders, kept for compatibility
    'exampleImageID','exampleImageID','exampleImageID','exampleImageID','exampleImageID',
    'exampleImageID','exampleImageID','exampleImageID','exampleImageID','exampleImageID',
    'exampleImageID','exampleImageID','exampleImageID','exampleImageID','exampleImageID','exampleImageID'
];

// ---------------------------------------------------------------------------------------
// Below this line, please do not modify unless you know what you are doing.
// ---------------------------------------------------------------------------------------

(function() {
    'use strict';

    // Local in‑memory cache, synced with GM storage
    let data = {};

    // Load persisted cache
    if (GM_getValue("neo_item_db")) {
        try {
            data = JSON.parse(GM_getValue("neo_item_db"));
        } catch(e) {
            data = {};
        }
    }

    // Pending request deduplication list
    let pending_list = [];

    // Format large numbers with K/M suffix
    function nFormatter(num, digits) {
        if (num < 1000) return num;
        if (num < 10000) return (num / 1000).toFixed(1) + 'K';
        if (num < 1000000) return (num / 1000).toFixed(0) + 'K';
        if (num < 100000000) return (num / 1000000).toFixed(1) + 'M';
        return (num / 1000000).toFixed(0) + 'M';
    }

    // Returns an HTML string for the price, colored by range.
    // A light background is added to keep dark text readable on the dark tooltip.
    function formatPriceHtml(price) {
        const formatted = nFormatter(price);
        let color = 'inherit';
        if (price >= 50000000) {
            color = 'darkviolet';
        } else if (price >= 10000000) {
            color = 'darkred';
        } else if (price >= 5000000) {
            color = 'red';
        } else if (price >= 1000000) {
            color = 'lightcoral';
        }
        if (color !== 'inherit') {
            // Use an opaque background to ensure readability on the dark tooltip
            return `<b style="color:${color}; background: rgba(255,255,255,0.85); padding: 0 3px; border-radius: 2px;">${formatted}</b>`;
        }
        return formatted; // default color, no background needed
    }

    // Extract the image ID (filename without extension) from a URL or filename
    function getImageId(filename) {
        if (!filename) return null;
        const name = filename.includes("/") ? filename.split("/").pop() : filename;
        return name.replace(/\.[^/.]+$/, "");
    }

    // Show a toast message in the bottom‑right corner
    function showToast(message, duration = 0) {
        const $toast = $('#price-toast');
        if ($toast.length === 0) {
            $('body').append('<div id="price-toast" style="position:fixed; bottom:20px; right:20px; background:rgba(0,0,0,0.85); color:#fff; padding:10px 15px; border-radius:6px; z-index:9999; font-size:13px; max-width:350px; display:none;"></div>');
            return showToast(message, duration);
        }
        $toast.text(message).stop(true, true).fadeIn(200);
        if (duration > 0) {
            setTimeout(() => $toast.fadeOut(500), duration);
        }
    }

    // Ignore UI text that is not an item name (buttons, etc.)
    function isValidItemName(name) {
        if (!name) return false;
        const nonItems = ['check all', 'remove one', 'select all', 'update all', 'price all', 'submit', 'reset', 'cancel'];
        return !nonItems.includes(name.toLowerCase().trim());
    }

    // Insert or update an item in the cache (keyed by image_id, dedup by item_id)
    function upsertItem(itemData) {
        if (!itemData || !itemData.internal_id) return;

        let imageId = null;
        if (itemData.image) {
            imageId = getImageId(itemData.image);
        }
        const key = imageId || `id_${itemData.internal_id}`;

        if (!data[key]) data[key] = [];

        let existing = data[key].find(i => i.id === itemData.internal_id);
        if (!existing) {
            // Check if the item already exists under another key
            for (const k in data) {
                const idx = data[k].findIndex(i => i.id === itemData.internal_id);
                if (idx !== -1) {
                    existing = data[k].splice(idx, 1)[0];
                    if (data[k].length === 0) delete data[k];
                    break;
                }
            }
        }

        const now = new Date().toLocaleString("sv");
        if (existing) {
            existing.name = itemData.name;
            existing.rarity = itemData.rarity;
            existing.update = now;
            if (itemData.price && itemData.price.value) {
                existing.price = itemData.price.value;
                existing.date = itemData.price.addedAt;
            }
            if (imageId && imageId !== existing.image_id) {
                existing.image_id = imageId;
            }
            if (!data[key]) data[key] = [];
            if (!data[key].includes(existing)) {
                data[key].push(existing);
            }
        } else {
            const newEntry = {
                item_id: itemData.internal_id,
                name: itemData.name,
                rarity: itemData.rarity,
                id: itemData.internal_id,
                update: now,
                price: itemData.price?.value || null,
                date: itemData.price?.addedAt || null,
                image_id: imageId
            };
            data[key].push(newEntry);
        }

        GM_setValue("neo_item_db", JSON.stringify(data));
    }

    // Batch request prices using image IDs.
    // The optional callback is invoked after successful fetch and cache update.
    function requestPricesByImageIds(imageIds, callback) {
        const idsToFetch = imageIds.filter(id => {
            if (!id || pending_list.includes(id)) return false;
            const cached = data[id];
            if (cached && cached.length === 1) {
                const item = cached[0];
                if (item.update && new Date() - new Date(item.update) <= 1000 * 60 * 60 * 24 * 7) {
                    return false; // fresh enough
                }
            }
            pending_list.push(id);
            return true;
        });

        if (idsToFetch.length === 0) {
            if (callback) callback();
            return;
        }

        const names = idsToFetch.map(id => data[id]?.[0]?.name || id);
        showToast(`Querying ${names.length} items: ${names.slice(0,3).join(', ')}${names.length > 3 ? '...' : ''}`);

        const params = idsToFetch.map(id => `image_id[]=${encodeURIComponent(id)}`).join('&');
        const url = `https://itemdb.com.br/api/v1/items/many?${params}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: { 'Accept': 'application/json' },
            onload: function(res) {
                if (res.status === 200) {
                    try {
                        const itemsData = JSON.parse(res.responseText);
                        for (const [imageId, item] of Object.entries(itemsData)) {
                            if (!item.image) item.image = `https://images.neopets.com/items/${imageId}.gif`;
                            upsertItem(item);
                        }
                        showToast('Price query completed', 2000);
                    } catch(e) {
                        showToast('Failed to parse price data', 2000);
                    }
                } else {
                    showToast('Price query failed', 2000);
                }
                if (callback) callback();
            },
            onerror: function() {
                showToast('Network error', 2000);
                if (callback) callback();
            }
        });
    }

    // Query a single item by name. Optional callback receives the upserted entry.
    function requestPriceByName(itemName, callback) {
        if (!itemName) return;
        const cleanName = itemName.replace(/\s*\([^)]*\)/g, '').trim();
        showToast(`Querying: ${cleanName}`);
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://itemdb.com.br/api/v1/items/${encodeURIComponent(cleanName)}`,
            headers: { 'Accept': 'application/json' },
            onload: function(res) {
                if (res.status === 200) {
                    try {
                        const item = JSON.parse(res.responseText);
                        upsertItem(item);
                        showToast('Query completed', 2000);
                        if (callback) {
                            const entry = Object.values(data).flat().find(i => i.id === item.internal_id);
                            callback(entry);
                        }
                    } catch(e) {
                        showToast('Query failed', 2000);
                        if (callback) callback();
                    }
                } else {
                    showToast('Name query failed', 2000);
                    if (callback) callback();
                }
            },
            onerror: function() {
                showToast('Network error', 2000);
                if (callback) callback();
            }
        });
    }

    // Core function that walks the DOM and attaches price tooltips.
    function bind_dom(obj) {
        // Build a name‑based lookup for Quick Stock
        let temp_data = {};
        for (const key in data) {
            data[key].forEach(item => {
                if (!temp_data[item.name]) temp_data[item.name] = [];
                temp_data[item.name].push(item);
            });
        }

        const targets = $(obj.dom);
        let imageIds = [];
        let temp_html = "";

        for (let i = 0; i < targets.length; i++) {
            const $target = targets.eq(i);
            let raw = obj.imgFunc($target);
            if (raw === false) continue;

            if (obj.type === "name") {
                const itemName = raw;
                if (!isValidItemName(itemName)) continue;
                let priceText = "?";
                const items = temp_data[itemName];
                if (items && items.length > 0) {
                    const priced = items.find(it => it.price > 0);
                    const chosen = priced || items[0];
                    priceText = chosen.price ? formatPriceHtml(chosen.price) : "?";
                }
                const pos = $target.offset();
                if (pos) {
                    temp_html += `<div class="po_chan_tooltip po_chan_tooltip_left" data-img="${itemName.replace(/"/g, '&quot;')}" style="top: ${pos.top - 15}px; left: ${pos.left - 15}px;">${priceText}</div>`;
                }
                continue;
            }

            // Image‑based detection
            let imgUrl = raw;
            if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
            if (!imgUrl.includes('images.neopets.com/items')) continue;
            const filename = imgUrl.split('/').pop();
            if (filename === 'ffu_illusen_armoire.gif') continue;

            const imageId = getImageId(filename);

            // Special images that always show a bold green "?"
            if (imageId && useQuestionMarkForTheseImages.includes(imageId.toLowerCase())) {
                let priceText = `<b style="color:green;">?</b>`;
                const pos = $target.offset();
                if (pos) {
                    temp_html += `<div class="po_chan_tooltip po_chan_tooltip_left" data-img="${filename}" style="top: ${pos.top - 15}px; left: ${pos.left - 15}px;">${priceText}</div>`;
                }
                continue;
            }

            let priceText = "?";
            const cachedItems = imageId ? data[imageId] : null;

            if (cachedItems && cachedItems.length > 0) {
                const priced = cachedItems.find(it => it.price > 0);
                const chosen = priced || cachedItems[0];
                if (!chosen.update || new Date() - new Date(chosen.update) > 1000 * 60 * 60 * 24 * 7) {
                    imageIds.push(imageId);
                }
                priceText = chosen.price ? formatPriceHtml(chosen.price) : "?";
            } else if (imageId) {
                imageIds.push(imageId);
                priceText = "…";
            }

            const pos = $target.offset();
            if (pos) {
                temp_html += `<div class="po_chan_tooltip po_chan_tooltip_left" data-img="${filename}" style="top: ${pos.top - 15}px; left: ${pos.left - 15}px;">${priceText}</div>`;
            }
        }

        if (imageIds.length > 0) {
            requestPricesByImageIds(imageIds);
        }

        $('#po_chan_tooltip_list').append(temp_html);
    }

    $(document).ready(function() {
        // Inject styles
        $("head").append(`<style>
            .po_chan_tooltip a{color: cornflowerblue;}
            .po_chan_tooltip {position: absolute; background-color: rgba(0,0,0,0.6); color: #fff; padding: 5px 10px; border-radius: 4px; font-size: 14px; z-index: 99;}
            .po_chan_tooltip_list {position: absolute; left: 0; top: 0;}
            .po_chan_tooltip_left.po_chan_tooltip {cursor: default; padding: 1px 2px;}
            .info-container {display: flex; flex-direction: column; justify-content: flex-start; align-items: flex-start;}
            .basic-icon {width: 32px;}
            .basic-info {display: flex; flex-direction: row; justify-content: flex-start; align-items: center;}
        </style><style id="po_chan_hide"></style>`);

        $("body").append(`<div id="po_chan_tooltip_list" class="po_chan_tooltip_list"></div><div id="po_chan_tooltip" class="po_chan_tooltip"></div>`);

        let check = false; // prevent double submission

        // Detailed tooltip on hover
        $(document).on('mouseenter', ".po_chan_tooltip", function(event) {
            const $this = $(this);
            const rawKey = $this.attr("data-img");
            let d_arr = [];

            const imageId = getImageId(rawKey);
            if (imageId && data[imageId]) d_arr = data[imageId];
            if (d_arr.length === 0) {
                d_arr = Object.values(data).flat().filter(item => item.name === rawKey);
            }

            if (d_arr.length === 0) return;

            let tooltipText = `<div class="basic-info"><img class="basic-icon" src="https://images.neopets.com/themes/h5/basic/images/v3/gallery-icon.svg" /><div>${rawKey} (${d_arr.length} result(s))</div></div>`;
            d_arr.forEach(d => {
                tooltipText += `<div class="info-container" data-item-id="${d.item_id}">
                    <div class="basic-info"><img class="basic-icon" src="https://images.neopets.com/themes/h5/basic/images/v3/inventory-icon.svg">${d.name}</div>
                    <div class="basic-info"><img class="basic-icon" src="https://images.neopets.com/themes/h5/basic/images/level-icon.png">
                        <div><span class="price-info">${d.price ? formatPriceHtml(d.price) : "?"}</span> on ${d.date ? d.date.split("T")[0] : "no data"}
                        <a class="refresh-btn" data-id="${d.item_id}" data-name="${d.name.replace(/"/g, '&quot;')}" href="javascript:void(0)">Refresh</a></div>
                    </div>
                    <div class="update-info" style="margin-left:25px">Updated ${d.update || "never"}</div>
                    <div class="basic-info"><img class="basic-icon" src="https://images.neopets.com/themes/h5/basic/images/mood-icon.png" /><div>r${d.rarity}</div></div>
                    <div>
                        <a href="https://www.neopets.com/shops/wizard.phtml?string=${d.name.replaceAll(" ", "+")}"><img class="basic-icon" src="http://images.neopets.com/themes/h5/basic/images/shopwizard-icon.png"></a>
                        <a href="https://www.neopets.com/genie.phtml?type=process_genie&criteria=exact&auctiongenie=${d.name.replaceAll(" ", "+")}"><img class="basic-icon" src="http://images.neopets.com/themes/h5/basic/images/auction-icon.png"></a>
                        <a href="https://www.neopets.com/island/tradingpost.phtml?type=browse&criteria=item_exact&search_string=${d.name.replaceAll(" ", "+")}"><img class="basic-icon" src="http://images.neopets.com/themes/h5/basic/images/tradingpost-icon.png"></a>
                        <a href="https://www.neopets.com/safetydeposit.phtml?obj_name=${d.name.replaceAll(" ", "+")}"><img class="basic-icon" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAECklEQVRYhe1WS08jRxD+qj2PHQ8gbLB5SgaBQKDkyokDXPIbOOcX5RJFSi45RcovyCESIocoOawQSHhxQDwMEg/j4CEz4/FO90zlwIzXsMbrELTaw35SH2ZUVd/XVdVdDXzGZ3yKIKKPxwUAlmVNFAqFNcMwviwUChfZbPZ8b2/vLTP/PTg4eCuE8E9OTlgpxQDeAmgBYAB6EkcCiADESUzu4NASO5H8l8nitoCZmZmv19fXf3AcR0xNTcUDAwOy1WqBmZtE9I+U0t/Z2ckwc2wYhgOgngTIJiR+IirqEMAJ6SsANgADgALgE5F/c3PzZ7lc/lYTQmB6enpI3AOGYYhsNmtalgUAJoAcEWF2dhZhGMJ1Xei6DsMwwNy50f4QBAFM04RlWROVSuVHjYig67qdGjCzt4WI6xhSSjSbTRQKBTSbTRSLRdi23ZWkG+I4xvX1NUzThFIKvu8PEVFWS0j1pxyFEDg6OsLW1haICBsbG1heXka5XEYURdD1J10fwPM85PN5LCwsYHt7G47jCACkJTsNezm7rotarYZMJgOlFEZHR5HP53F4eAjbtj9YCqUUTNPEysoKhBCpvQYgozEzWq2WSo9eFEXvBZBSPiBhZmQyGQwPD2NwcPCDAlJ/ImqXN5vNGpOTk5rGzFBKRUTUNngKhmHAMIwHQh73Szc8tmFmWJYlJicnNQ0AiOjJQjIz5ufnsbq6CiJCsVh8Vvd3gWDmjJZ85HsJyOVyKJVKcF0XQoiXIG8LSKMN9bLsTHUcx/+bOSl1JggCU+D+5tL6cSKirk36TBhRFL1KM9Azr8lJQRAEL0UOABkARkr85PgTQqBarWJzcxPlcrndgGlG/svqIkBPU99z/jqOg0ajAeDdPSGlhOd5iOO4r4tICIEoiqBp7WoLAFpfAjoDKaXQaDQwMTGBpaWlvt8OjUYDR0dHKJVKqQ8BoFRAz9Y2TWNjY0PI5XJoNBoYGRnB3Nxc33MAAEqlEqrVKvb39+G6bjsTGgAKw9BMd/L4mDEzSqUS1tbWwMw4PT2FlBKVSqVv8hREhHq9DsdxMD4+HgNQqQArbZRuAgYGBmBZFoiIdT2PPc9rF11KSVEUpd9xstLXkcL9oAuT7wwR2SMjI7bnebdhGNbTEnTtIiJCEAS4u7ur6rr+i+/7f4Rh6CYEDAC7u7u4uLgAEXHyX3WsEO9eSwr3T7McgGFmdqWU+10vICKCUgp3d3e1s7Ozn46Pj78/PT39y/O893qln2HUC10FuK7bvLy8/LVSqXxzfHz8++3trXw2Qz8CmJnDMIRSimu12ptarfbd69evfz4/P6+/xN3fCwSAbNv+amxs7IvFxcXg4ODgt6urqze+77/IzO0byYv4o3J+EvgX4yIhYBP/dWUAAAAASUVORK5CYII="></a>
                        <a href="https://items.jellyneo.net/search/?name=${d.name.replaceAll(" ", "+")}"><img class="basic-icon" src="data:image/png;base64,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"></a>
                        <a href="https://itemdb.com.br/item/${d.name.replaceAll(" ", "-")}/"><img class="basic-icon" src="https://images.neopets.com/themes/h5/basic/images/v3/quickstock-icon.svg"></a>
                    </div>
                    <div class="clear"><a class="clear-btn" href="javascript:void(0)">Clear Data</a></div>
                    <div class="timer"></div>
                </div>`;
            });

            const id = Math.random();
            $('#po_chan_tooltip').html(tooltipText).show().attr('data-id', id);
            const pos = $this.offset();
            $('#po_chan_tooltip').css({
                top: pos.top + $this.height() - 5,
                left: pos.left + $this.width() - 5
            });

            let de_time = 1000, time = 2000;
            const $detailBox = $(`#po_chan_tooltip[data-id="${id}"]`);
            $detailBox.on('mouseenter', () => { de_time = 0; time = 2000; });
            $detailBox.on('mouseleave', () => { de_time = 1000; });
            $detailBox.find('.timer').html(`(${time/1000} sec <a href="javascript:void(0)" class="close-btn">Close</a>)`);
            const timer = setInterval(() => {
                time -= de_time;
                $detailBox.find('.timer').html(`(${time/1000} sec <a href="javascript:void(0)" class="close-btn">Close</a>)`);
                $detailBox.find('.close-btn').off().on('click', () => {
                    $detailBox.html("").hide();
                });
                if (time <= 0) {
                    clearInterval(timer);
                    $detailBox.html("").hide();
                }
            }, 1000);

            // Clear all data
            $detailBox.find('.clear-btn').off().on('click', () => {
                if (!check) {
                    check = true;

                    if (confirm("Are you sure you want to clear all cached data?")) {
                        data = {};
                        GM_setValue("neo_item_db", JSON.stringify({}));
                    }
                    check = false;
                }
            });

            // Refresh button – fetch fresh price and update the tooltip immediately
            $detailBox.find('.refresh-btn').off().on('click', function() {
                const $btn = $(this);
                const itemId = $btn.attr("data-id");
                const itemName = $btn.attr("data-name");
                if (check) return;
                check = true;
// Make it outof date
if (itemId) {
    for (const key in data) {
        data[key].forEach(item => {
            if (item.id == itemId) {
                item.update = null; //
            }
        });
    }
    // set it
    GM_setValue("neo_item_db", JSON.stringify(data));
}
                // Callback that updates the tooltip content when data arrives
                const updateTooltip = () => {
                    // Re‑read the cached item(s) for this item_id
                    const freshItems = Object.values(data).flat().filter(i => i.id == itemId);
                    if (freshItems.length > 0) {
                        const fresh = freshItems[0];
                        const priceHtml = fresh.price ? formatPriceHtml(fresh.price) : "?";
                        const dateStr = fresh.date ? fresh.date.split("T")[0] : "no data";
                        const updateStr = fresh.update || "never";
                        // Update the price info section inside the currently visible detailed tooltip
                        const $container = $btn.closest('.info-container');
                        $container.find('.price-info').html(priceHtml);
                        $container.find('.update-info').html(`Updated ${updateStr}`);
                        // Also update the small price tooltip on the main page
                        const $smallTooltip = $(`.po_chan_tooltip_left[data-img="${rawKey.replace(/"/g, '\\"')}"]`);
                        if ($smallTooltip.length) {
                            $smallTooltip.html(priceHtml);
                        }
                    }
                    check = false;
                };

                if (itemId && itemId !== "-1") {
                    const cached = Object.values(data).flat().find(i => i.item_id == itemId);
                    if (cached && cached.image_id) {
                        requestPricesByImageIds([cached.image_id], updateTooltip);
                    } else if (itemName) {
                        requestPriceByName(itemName, updateTooltip);
                    } else {
                        check = false;
                    }
                } else if (itemName) {
                    requestPriceByName(itemName, updateTooltip);
                } else {
                    check = false;
                }
            });
        });

        // Refresh the entire overlay periodically and on load
        function refresh() {
            $('#po_chan_tooltip_list').html("");
            // Regular images
            bind_dom({ dom: "img", imgFunc: t => t.attr("src") });
            // Shop background images
            bind_dom({
                dom: ".item-img",
                imgFunc: function(target) {
                    const bg = target.get(0).style.backgroundImage;
                    const match = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
                    return match ? match[1] : false;
                }
            });
            // Quick Stock (filter out non‑item text)
            if (location.href.includes("quickstock")) {
                bind_dom({
                    dom: "#quickstock-table-container tr",
                    imgFunc: function(target) {
                        const td = target.find('td:first-child');
                        if (!td.length) return false;
                        const clone = td.clone();
                        clone.find('.qs-count-badge').remove();
                        const name = clone.text().trim();
                        if (!isValidItemName(name)) return false;
                        return name;
                    },
                    type: "name"
                });
            }
        }

        setTimeout(refresh, 10);
        setInterval(refresh, 750);

        // Toggle price display with Ctrl+B
        let _show = true;
        document.addEventListener('keydown', function(event) {
            if (event.key === "b" && event.ctrlKey) {
                _show = !_show;
                $("#po_chan_hide").html(_show ? "" : ".po_chan_tooltip {display:none !important}");
            }
        });
    });
})();
