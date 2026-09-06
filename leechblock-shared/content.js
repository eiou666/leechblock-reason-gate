/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const browser = chrome;

const TIMER_SIZES = ["10px", "12px", "14px", "16px"];

const TIMER_LOCATIONS = [
	["0px", "auto", "0px", "auto"],
	["0px", "auto", "auto", "0px"],
	["auto", "0px", "auto", "0px"],
	["auto", "0px", "0px", "auto"]
];

var gTimer;
var gAlert;
var gContentActive = true;

// Reloading an extension leaves its old content scripts in already-open pages.
// Stop those listeners once their runtime disappears instead of throwing on focus.
function stopContentScript() {
	if (!gContentActive) return;
	gContentActive = false;
	window.removeEventListener("focus", onFocus);
	window.removeEventListener("blur", onBlur);
	window.removeEventListener("pagehide", onPageHide);
	try { browser.runtime.onMessage.removeListener(handleMessage); } catch (_) {}
	onPageHide();
}

async function sendBackgroundNotification(message) {
	if (!gContentActive) return;
	try {
		if (!browser.runtime.id) {
			stopContentScript();
			return;
		}
		await browser.runtime.sendMessage(message);
	} catch (error) {
		const text = String(error?.message || error);
		if (/Extension context invalidated/i.test(text)) {
			stopContentScript();
		} else if (!/Receiving end does not exist|The message port closed before a response was received/i.test(text)) {
			console.warn("[LBNG] Cannot notify background: " + text);
		}
	}
}

// Notify background script that page has loaded
//
function notifyLoaded() {
	// Register that this script has now loaded
	sendBackgroundNotification({ type: "loaded", url: document.URL });

	// Send URL of referring page to background script
	sendBackgroundNotification({ type: "referrer", referrer: document.referrer });
}

// Update timer
//
function updateTimer(text, size, location) {
	if (!text) {
		if (gTimer) {
			// Hide timer
			gTimer.hidden = true;
		}
	} else {
		if (!gTimer) {
			// Create timer
			gTimer = document.createElement("div");
			gTimer.setAttribute("class", "leechblock-timer");
			gTimer.addEventListener("dblclick", function (e) { this.style.display = "none"; });
		}

		if (!document.documentElement.contains(gTimer)) {
			// Insert timer at end of document
			document.documentElement.appendChild(gTimer);
		}

		// Set text
		gTimer.innerText = text;

		// Set size
		if (size >= 0 && size < TIMER_SIZES.length) {
			gTimer.style.fontSize = TIMER_SIZES[size];
		}

		// Set location
		if (location >= 0 && location < TIMER_LOCATIONS.length) {
			gTimer.style.top = TIMER_LOCATIONS[location][0];
			gTimer.style.bottom = TIMER_LOCATIONS[location][1];
			gTimer.style.left = TIMER_LOCATIONS[location][2];
			gTimer.style.right = TIMER_LOCATIONS[location][3];
		}

		// Show timer
		gTimer.hidden = false;
	}
}

// Show alert message
//
function showAlert(text) {
	let alertBox, alertIcon, alertText;

	if (!gAlert) {
		// Create container
		gAlert = document.createElement("div");
		gAlert.setAttribute("class", "leechblock-alert-container");
		document.documentElement.appendChild(gAlert);

		// Create message box
		alertBox = document.createElement("div");
		alertBox.setAttribute("class", "leechblock-alert-box");
		alertBox.addEventListener("click", hideAlert);
		alertIcon = document.createElement("div");
		alertIcon.setAttribute("class", "leechblock-alert-icon");
		alertBox.appendChild(alertIcon);
		alertText = document.createElement("div");
		alertText.setAttribute("class", "leechblock-alert-text");
		alertBox.appendChild(alertText);
		gAlert.appendChild(alertBox);
	}

	// Set text
	alertText.innerText = text;

	// Show timer
	gAlert.style.display = "flex";
}

// Hide alert message
//
function hideAlert() {
	if (gAlert) {
		gAlert.style.display = "none";
	}
}

// Check page for keyword(s)
//
function checkKeyword(keywordRE, titleOnly) {
	if (!keywordRE) {
		return null; // nothing to find!
	}

	// Get all text from document (including title)
	let text = document.title;
	if (!titleOnly && document.body) {
		text += "\n" + document.body.innerText;
	}

	// Search text for keywords
	let matches = keywordRE.exec(text);
	if (!matches) {
		return null; // keyword(s) not found
	}
	return matches[0]; // keyword(s) found
}

// Apply filter
//
function applyFilter(filterName, filterCustom) {
	let filters = {
		"none": "none",
		"blur (1px)": "blur(1px)",
		"blur (2px)": "blur(2px)",
		"blur (4px)": "blur(4px)",
		"blur (8px)": "blur(8px)",
		"blur (16px)": "blur(16px)",
		"blur (32px)": "blur(32px)",
		"fade (80%)": "opacity(20%)",
		"fade (90%)": "opacity(10%)",
		"fade (100%)": "opacity(0%)",
		"grayscale": "grayscale(100%)",
		"invert": "invert(100%)",
		"sepia": "sepia(100%)",
		"custom": filterCustom
	};
	if (filterName && filters[filterName]) {
		document.documentElement.style.filter = filters[filterName];
	} else {
		document.documentElement.style.filter = "none";
	}
}

/*** EVENT HANDLERS BEGIN HERE ***/

function handleMessage(message, sender, sendResponse) {

	switch (message.type) {

		case "alert":
			showAlert(message.text);
			break;

		case "filter":
			applyFilter(message.filterName, message.filterCustom);
			break;

		case "keyword":
			let keyword = checkKeyword(new RegExp(message.keywordRE, "iu"), message.titleOnly); // Chrome workaround
			sendResponse(keyword);
			break;

		case "ping":
			notifyLoaded();
			break;

		case "timer":
			updateTimer(message.text, message.size, message.location);
			break;

	}

}

function onFocus(event) {
	sendBackgroundNotification({ type: "focus", focus: true });
}

function onBlur(event) {
	sendBackgroundNotification({ type: "focus", focus: false });
}

function onPageHide(event) {
	if (gTimer && gTimer.parentNode) {
		gTimer.parentNode.removeChild(gTimer);
		gTimer = null;
	}

	if (gAlert && gAlert.parentNode) {
		gAlert.parentNode.removeChild(gAlert);
		gAlert = null;
	}
}

browser.runtime.onMessage.addListener(handleMessage);

window.addEventListener("focus", onFocus);
window.addEventListener("blur", onBlur);
window.addEventListener("pagehide", onPageHide);

notifyLoaded();
