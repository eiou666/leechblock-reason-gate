/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const browser = chrome;

var gBlockedURL;
var gBlockedSet;
var gHashCode;

// An async boundary also converts Chrome's synchronous invalid-context throw
// into a rejection, so every caller can keep the gate closed on failure.
async function sendGateMessage(message) {
	return browser.runtime.sendMessage(message);
}

function reportGateMessageError(error) {
	const text = String(error?.message || error);
	const submit = document.getElementById("submit");
	if (submit) submit.title = "扩展连接已中断，请刷新此页面后重试";
	if (!/Extension context invalidated|Receiving end does not exist|The message port closed before a response was received/i.test(text)) {
		console.warn("[LBNG] Cannot communicate with reason gate: " + text);
	}
}

// The local single-page gate never auto-submits and never displays a countdown.
// Measure from navigation start, so extension startup latency adds no extra wait.
function setupInlineReasonGate(info) {
	const app = document.getElementById("app");
	if (!app || app.getAttribute("data-lb-reason-gate") != "inline-v1") return false;
	const internalGate = browser.runtime.getURL?.("reason-gate.html");
	const isInternal = internalGate && location.href.split(/[?#]/)[0] === internalGate;
	if (!isInternal && (location.origin != "http://127.0.0.1:8765"
			|| location.pathname != "/lb-custom/reason-gate.html")) return false;
	const reason = document.getElementById("reason");
	const submit = document.getElementById("submit");
	if (!reason || !submit) return true;
	// A missing extension response must not turn this into an unguarded redirect.
	if (!info.blockedURL || !/^[1-9]\d*$/.test(String(info.blockedSet))) return true;
	if (app.getAttribute("data-lb-reason-gate-bound") == "true") return true;
	app.setAttribute("data-lb-reason-gate-bound", "true");

	const configuredSeconds = Number(info.delaySecs);
	const readyAt = Math.max(5, Number.isFinite(configuredSeconds) ? configuredSeconds : 5) * 1000;
	let submitted = false;
	const updateButton = () => {
		const remaining = readyAt - performance.now();
		submit.disabled = submitted || remaining > 0;
		if (remaining > 0) window.setTimeout(updateButton, remaining);
	};
	const begin = () => {
		// Check the deadline here too: keyboard/synthetic events cannot skip it.
		if (submitted || performance.now() < readyAt) return;
		if (reason.value.replace(/\s/g, "").length < 5) {
			reason.setCustomValidity("至少输入5个非空白字符");
			reason.reportValidity();
			reason.focus();
			return;
		}
		reason.setCustomValidity("");
		submitted = true;
		submit.disabled = true;
		// Reuse the existing global grant handler; no reload or intermediate page.
		sendGateMessage({ type: "delayed", blockedURL: info.blockedURL,
			blockedSet: info.blockedSet }).catch(error => {
			// A transient failure can be retried; an invalidated page needs a refresh.
			submitted = false;
			if (/Extension context invalidated/i.test(String(error?.message || error))) {
				submitted = true;
			} else {
				updateButton();
			}
			reportGateMessageError(error);
		});
	};
	reason.addEventListener("input", () => reason.setCustomValidity(""));
	submit.addEventListener("click", begin);
	reason.addEventListener("keydown", event => {
		// Enter submits; Shift+Enter keeps multiline input. IME confirmation is not submission.
		if (event.key == "Enter" && !event.shiftKey && !event.isComposing
				&& event.keyCode !== 229 && !event.repeat) {
			event.preventDefault();
			begin();
		}
	});
	updateButton();
	return true;
}

// Create 32-bit integer hash code from string
//
function hashCode32(str) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
	}
	return hash;
}

// Processes info for blocking page
//
function processBlockInfo(info) {
	if (!info) return;

	gBlockedURL = info.blockedURL;
	gBlockedSet = info.blockedSet;
	gHashCode = info.password ? hashCode32(info.password) : 0;

	if (setupInlineReasonGate(info)) return;

	// Set theme
	let themeLink = document.getElementById("themeLink");
	if (themeLink) {
		themeLink.href = "/themes/" + (info.theme ? `${info.theme}.css` : "default.css");
	}

	// Set custom style
	let customStyle = document.getElementById("customStyle");
	if (customStyle) {
		customStyle.innerText = info.customStyle;
	}

	let blockedURL = document.getElementById("lbBlockedURL");
	if (info.blockedURL && blockedURL) {
		if (info.blockedURL.length > 60) {
			blockedURL.innerText = info.blockedURL.substring(0, 57) + "...";
		} else {
			blockedURL.innerText = info.blockedURL;
		}
	}

	let blockedURLLink = document.getElementById("lbBlockedURLLink");
	if (info.blockedURL && blockedURLLink && !info.disableLink) {
		blockedURLLink.setAttribute("href", info.blockedURL);
	}

	let blockedSet = document.getElementById("lbBlockedSet");
	if (info.blockedSet && blockedSet) {
		if (info.blockedSetName) {
			blockedSet.innerText = info.blockedSetName;
		} else {
			blockedSet.innerText += " " + info.blockedSet;
		}
		document.title += " (" + blockedSet.innerText + ")";
	}

	let keywordMatched = document.getElementById("lbKeywordMatched");
	let keywordMatch = document.getElementById("lbKeywordMatch");
	if (keywordMatched && keywordMatch) {
		if (info.keywordMatch) {
			keywordMatch.innerText = info.keywordMatch;
			keywordMatched.style.display = "";
		} else {
			keywordMatched.style.display = "none";
		}
	}

	let passwordInput = document.getElementById("lbPasswordInput");
	let passwordSubmit = document.getElementById("lbPasswordSubmit");
	if (passwordInput && passwordSubmit) {
		passwordInput.focus();
		passwordSubmit.onclick = onSubmitPassword;
	}

	let customMsgDiv = document.getElementById("lbCustomMsgDiv");
	let customMsg = document.getElementById("lbCustomMsg");
	if (customMsgDiv && customMsg) {
		if (info.customMsg) {
			customMsg.innerText = info.customMsg;
			customMsgDiv.style.display = "";
		} else {
			customMsgDiv.style.display = "none";
		}
	}

	let unblockTime = document.getElementById("lbUnblockTime");
	if (info.unblockTime && unblockTime) {
		unblockTime.innerText = info.unblockTime;
	}

	let delaySecs = document.getElementById("lbDelaySeconds");
	if (info.delaySecs && delaySecs) {
		delaySecs.innerText = info.delaySecs;

		// Start countdown timer
		let countdown = {
			delaySecs: info.delaySecs,
			delayCancel: info.delayCancel
		};
		countdown.interval = window.setInterval(onCountdownTimer, 1000, countdown);
	}

	if (info.reloadSecs) {
		// Reload blocked page after specified time
		window.setTimeout(reloadBlockedPage, info.reloadSecs * 1000);
	}
}

// Handle countdown on delaying page
//
function onCountdownTimer(countdown) {
	// Cancel countdown if document not focused
	if (countdown.delayCancel && !document.hasFocus()) {
		// Clear countdown timer
		window.clearInterval(countdown.interval);

		// Strike through countdown text
		let countdownText = document.getElementById("lbCountdownText");
		if (countdownText) {
			countdownText.style.textDecoration = "line-through";
		}

		return;
	}

	countdown.delaySecs--;

	// Update countdown seconds on page
	let delaySecs = document.getElementById("lbDelaySeconds");
	if (delaySecs) {
		delaySecs.innerText = countdown.delaySecs;
	}

	if (countdown.delaySecs == 0) {
		// Clear countdown timer
		window.clearInterval(countdown.interval);

		// Notify extension that delay countdown has completed
		let message = {
			type: "delayed",
			blockedURL: gBlockedURL,
			blockedSet: gBlockedSet
		};
		sendGateMessage(message).catch(reportGateMessageError);
	}
}

// Handle submit button on password page
//
function onSubmitPassword() {
	let passwordInput = document.getElementById("lbPasswordInput");
	if (hashCode32(passwordInput.value) == gHashCode) {
		// Notify extension that password was successfully entered
		let message = {
			type: "password",
			password: passwordInput.value,
			blockedURL: gBlockedURL,
			blockedSet: gBlockedSet
		};
		sendGateMessage(message).catch(reportGateMessageError);
	} else {
		// Clear input field and flash background
		passwordInput.value = "";
		passwordInput.classList.add("error");
		window.setTimeout(() => { passwordInput.classList.remove("error"); }, 400);
	}
}

// Attempt to reload blocked page
//
function reloadBlockedPage() {
	if (gBlockedURL) {
		document.location.href = gBlockedURL;
	}
}

// Request block info from extension
sendGateMessage({ type: "blocked" }).then(processBlockInfo).catch(reportGateMessageError);
