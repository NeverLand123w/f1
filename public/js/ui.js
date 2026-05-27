const SERVER_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

const AUTH_STATE = {
    isLoginMode: true,
    stage: 'CREDS',
    tempUser: null,
    token: null,
    username: null,
    tokens: 0,
    isGuest: false
};


// ── Global toast notification ─────────────────────────────────────────────
function showToast(msg, type = 'info') {
    let t = document.getElementById('f1-global-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'f1-global-toast';
        t.style.cssText = [
            'position:fixed', 'bottom:28px', 'right:28px', 'z-index:999999',
            'background:rgba(8,10,14,0.97)', 'border:1px solid rgba(255,255,255,0.08)',
            'border-radius:8px', 'padding:13px 20px',
            'font-family:\'Orbitron\',monospace', 'font-size:11px', 'font-weight:700',
            'letter-spacing:1.5px', 'color:#f0f4f8',
            'box-shadow:0 8px 30px rgba(0,0,0,0.7)',
            'backdrop-filter:blur(12px)',
            'pointer-events:none', 'max-width:320px',
            'opacity:0', 'transform:translateY(8px)',
            'transition:opacity 0.25s,transform 0.25s',
            'border-left:3px solid var(--green)'
        ].join(';');
        document.body.appendChild(t);
    }
    const colors = { info: 'var(--green)', error: 'var(--red)', warn: 'var(--gold)' };
    t.style.borderLeftColor = colors[type] || colors.info;
    t.textContent = msg;
    t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    clearTimeout(window._f1ToastTimer);
    window._f1ToastTimer = setTimeout(() => {
        t.style.opacity = '0'; t.style.transform = 'translateY(8px)';
    }, 3200);
}

function initAuth() {
    const modal = document.getElementById('auth-modal');
    const submitBtn = document.getElementById('auth-submit');
    const switchBtn = document.getElementById('auth-switch');
    const errorText = document.getElementById('auth-error');

    const stageCreds = document.getElementById('stage-creds');
    const stageSetup = document.getElementById('stage-setup-2fa');
    const stageEnter = document.getElementById('stage-enter-2fa');

    const userIn = document.getElementById('auth-user');
    const passIn = document.getElementById('auth-pass');
    const otpIn = document.getElementById('auth-otp');

    function resetUI() {
        stageCreds.style.display = 'block';
        stageSetup.style.display = 'none';
        stageEnter.style.display = 'none';
        AUTH_STATE.stage = 'CREDS';
        errorText.style.display = 'none';
        submitBtn.textContent = AUTH_STATE.isLoginMode ? 'ENTER PASSWORD' : 'CREATE SECURE ACCOUNT';
    }

    switchBtn.onclick = () => {
        AUTH_STATE.isLoginMode = !AUTH_STATE.isLoginMode;
        document.getElementById('auth-title').textContent = AUTH_STATE.isLoginMode ? 'PADDOCK LOGIN' : 'REGISTRATION';
        switchBtn.textContent = AUTH_STATE.isLoginMode ? 'New driver? Create an account.' : 'Already have an account? Login.';
        resetUI();
    };

    submitBtn.onclick = async () => {
        if (AUTH_STATE.stage === 'CREDS') {
            const u = userIn.value.trim(); const p = passIn.value.trim();
            if (!u || !p) return showAuthError('Credentials missing!');
            AUTH_STATE.tempUser = u;

            submitBtn.textContent = 'ENCRYPTING...';
            try {
                const endpoint = AUTH_STATE.isLoginMode ? '/api/login' : '/api/register';
                const res = await fetch(`${SERVER_URL}${endpoint}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: u, password: p })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message);

                // Handle 2FA bypass — server returns token directly (e.g. test/Razorpay account)
                if (data.token) {
                    localStorage.setItem('f1_token', data.token);
                    localStorage.setItem('f1_username', data.username);
                    localStorage.setItem('f1_display_tokens', data.tokens);
                    AUTH_STATE.token = data.token;
                    updateUserInterface(data.username, data.tokens);
                    modal.classList.add('hidden');
                    return;
                }

                AUTH_STATE.stage = '2FA';
                stageCreds.style.display = 'none';
                stageEnter.style.display = 'block';

                if (data.qrImage) {
                    document.getElementById('qr-code-img').src = data.qrImage;
                    stageSetup.style.display = 'block';
                    submitBtn.textContent = 'FINISH SECURE SETUP';
                } else {
                    submitBtn.textContent = 'AUTHORIZE LOGIN';
                }
                errorText.style.display = 'none';

            } catch (e) {
                showAuthError(e.message);
                submitBtn.textContent = AUTH_STATE.isLoginMode ? 'ENTER PASSWORD' : 'CREATE SECURE ACCOUNT';
            }

        } else if (AUTH_STATE.stage === '2FA') {
            const otp = otpIn.value.trim();
            if (otp.length !== 6) return showAuthError('Requires exactly 6 digits');

            submitBtn.textContent = 'VERIFYING...';
            try {
                const endpoint2 = AUTH_STATE.isLoginMode ? '/api/login-verify' : '/api/verify-registration-2fa';
                const res = await fetch(`${SERVER_URL}${endpoint2}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: AUTH_STATE.tempUser, otpCode: otp })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message);

                if (AUTH_STATE.isLoginMode) {
                    localStorage.setItem('f1_token', data.token);
                    localStorage.setItem('f1_username', data.username);
                    localStorage.setItem('f1_display_tokens', data.tokens);
                    AUTH_STATE.token = data.token;
                    updateUserInterface(data.username, data.tokens);
                    modal.classList.add('hidden');
                } else {
                    showAuthError('Security Confirmed! Proceeding to Login.', '#00d2be');
                    setTimeout(() => { AUTH_STATE.isLoginMode = true; switchBtn.onclick(); }, 1500);
                }
            } catch (e) {
                showAuthError(e.message);
                submitBtn.textContent = AUTH_STATE.isLoginMode ? 'AUTHORIZE LOGIN' : 'FINISH SECURE SETUP';
            }
        }
    };

    document.getElementById('auth-guest').onclick = () => {
        modal.classList.add('hidden');
        updateUserInterface('GUEST', 0, [], true);
    };
    document.getElementById('nav-login-btn').onclick = () => { resetUI(); modal.classList.remove('hidden'); };

    function showAuthError(msg, color = 'var(--red)') { errorText.textContent = msg; errorText.style.color = color; errorText.style.display = 'block'; }
    checkExistingSession();
}

async function checkExistingSession() {
    const modal = document.getElementById('auth-modal');
    const token = localStorage.getItem('f1_token');
    if (!token) {
        modal.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch(`${SERVER_URL}/api/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (res.ok) {
            AUTH_STATE.token = token;
            localStorage.setItem('f1_username', data.username);
            localStorage.setItem('f1_display_tokens', data.tokens);
            updateUserInterface(data.username, data.tokens, data.activeBets);
            modal.classList.add('hidden');
        } else {
            localStorage.removeItem('f1_token');
            modal.classList.remove('hidden');
        }
    } catch (e) {
        console.error("Session fetch failed", e);
        modal.classList.remove('hidden');
    }
}

function updateUserInterface(username, tokens, activeBets = [], isGuest = false) {
    AUTH_STATE.username = username;
    AUTH_STATE.tokens = tokens;
    AUTH_STATE.isGuest = isGuest;
    if (activeBets && activeBets.length > 0 && !isGuest) {
        activeBetsCache = activeBets.map(b => ({ driver_name: b.driver_name, token_amount: b.token_amount, windowPenalty: b.window_penalty || 1.0 }));
    }

    document.getElementById('nav-login-btn').style.display = 'none';
    document.getElementById('user-info-box').style.display = 'flex';
    document.getElementById('display-username').textContent = isGuest ? 'GUEST' : username.toUpperCase();
    document.getElementById('display-tokens').textContent = Number(tokens).toFixed(1);

    const placeBetBtn = document.getElementById('place-bet-btn');
    const buyTokensBtn = document.getElementById('buy-tokens-btn');
    const tokenWrap = document.getElementById('token-display-wrap');
    const logoutBtn = document.getElementById('logout-btn');

    if (isGuest) {
        placeBetBtn.style.display = 'none'; buyTokensBtn.style.display = 'none';
        tokenWrap.style.display = 'none'; logoutBtn.style.display = 'none';
    } else {
        buyTokensBtn.style.display = 'block'; tokenWrap.style.display = 'inline-block';
        logoutBtn.style.display = 'block';
    }

    const betsUI = document.getElementById('active-bets-display');
    if (betsUI && activeBets.length > 0 && !isGuest) {
        betsUI.innerHTML = '';
        activeBets.forEach(bet => {
            const badge = document.createElement('div');
            badge.style.cssText = "background:rgba(0, 210, 190, 0.15); border:1px solid var(--green); color:var(--green); padding:3px 8px; border-radius:3px; font-size:9px; font-family:'Orbitron', monospace;";
            badge.innerHTML = `🎟️ ${bet.driver_name.toUpperCase()} <b>${bet.token_amount} TKN</b>`;
            betsUI.appendChild(badge);
        });
    }
}

// --- SECURE RAZORPAY PAYMENT ---
window.payWithRazorpay = async function (priceInRupees, tokenAmount) {
    const token = localStorage.getItem('f1_token');

    if (!token || token === "undefined" || token === "null") {
        showToast("Session expired — please log in again", "error");
        return;
    }

    try {
        const res = await fetch(`${SERVER_URL}/api/razorpay-create-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ price: priceInRupees, tokens: tokenAmount })
        });

        const orderData = await res.json();

        // --- NEW: CATCH ACTUAL SERVER ERRORS ---
        if (!res.ok) {
            showToast("Server error: " + (orderData.message || "Failed to initiate order"), "error");
            return;
        }

        if (orderData.devCredit) {
            AUTH_STATE.tokens = orderData.newBalance;
            document.getElementById('display-tokens').textContent = Number(orderData.newBalance).toFixed(1);
            showToast("Tokens credited (Dev Mode)", "info");
            return;
        }

        if (!orderData.razorpayKey) {
            showToast("Payment config error — contact support", "error");
            return;
        }

        const options = {
            key: orderData.razorpayKey,
            amount: orderData.amount,
            currency: orderData.currency || 'INR',
            order_id: orderData.orderId,
            name: 'F1 Paddock',
            description: `Purchase ${tokenAmount} Tokens`,
            handler: async function (response) {
                const verifyRes = await fetch(`${SERVER_URL}/api/razorpay-verify-payment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature,
                        purchasedTokens: tokenAmount
                    })
                });
                const result = await verifyRes.json();
                if (verifyRes.ok && result.newBalance !== undefined) {
                    AUTH_STATE.tokens = result.newBalance;
                    document.getElementById('display-tokens').textContent = Number(result.newBalance).toFixed(1);
                    localStorage.setItem('f1_display_tokens', result.newBalance);
                    showToast(`${tokenAmount} tokens credited!`, 'success');
                } else {
                    showToast(result.message || 'Verification failed', 'error');
                }
            },
            prefill: { name: AUTH_STATE.username },
            theme: { color: '#00d2be' }
        };

        const rzp = new Razorpay(options);
        rzp.open();
    } catch (err) {
        console.error("Payment Error:", err);
        showToast("Network error — check your connection", "error");
    }
};
function initBuyTokens() {
    const modal = document.getElementById('buy-tokens-modal');
    const payBtn = document.getElementById('buy-tokens-pay-btn');

    document.getElementById('buy-tokens-btn').onclick = () => {
        modal.classList.remove('hidden');
        document.getElementById('buy-tokens-msg').textContent = '';
        payBtn.disabled = true;
        document.querySelectorAll('.token-pack').forEach(p => p.classList.remove('selected'));
    };

    document.querySelectorAll('.token-pack').forEach(p => {
        p.onclick = () => {
            document.querySelectorAll('.token-pack').forEach(pack => pack.classList.remove('selected'));
            p.classList.add('selected');
            payBtn.disabled = false;
        };
    });

    payBtn.onclick = () => {
        const selected = document.querySelector('.token-pack.selected');
        if (selected) {
            const price = parseInt(selected.getAttribute('data-price'));
            const tokens = parseInt(selected.getAttribute('data-tokens'));
            window.payWithRazorpay(price, tokens);
            modal.classList.add('hidden');
        }
    };
}

window.selectPack = function (el) {
    document.querySelectorAll('.token-pack').forEach(p => p.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('buy-tokens-pay-btn').disabled = false;
};

function isRaceActive() {
    if (typeof F1Game === 'undefined' || !F1Game) return false;
    const activeStates = ['GREEN', 'SC', 'VSC', 'FORMATION', 'GRID_WAIT', 'GRID_PREP'];
    return activeStates.includes(F1Game.state);
}

function safeGoHome() {
    if (isRaceActive()) {
        sessionStorage.setItem('f1_race_running', '1'); window.location.href = 'index';
    } else {
        sessionStorage.removeItem('f1_race_running'); window.location.href = 'index';
    }
}

function initLogout() {
    document.getElementById('logout-btn').onclick = () => {
        if (isRaceActive()) { showToast('Race in progress — finish or terminate first', 'error'); return; }
        localStorage.removeItem('f1_token');
        localStorage.removeItem('f1_username');
        localStorage.removeItem('f1_display_tokens');
        AUTH_STATE.token = null; AUTH_STATE.username = null;
        AUTH_STATE.tokens = 0; AUTH_STATE.isGuest = false;
        document.getElementById('user-info-box').style.display = 'none';
        document.getElementById('place-bet-btn').style.display = 'none';
        document.getElementById('buy-tokens-btn').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'none';
        document.getElementById('nav-login-btn').style.display = 'block';
        document.getElementById('active-bets-display').innerHTML = '';
    };
}

let activeBetsCache = [];
let selectedDriversMap = {};
let extraLapsWindow = 0;

let flBetState = {
    active: false, lapNumber: 0, secondsLeft: 15, selectedDriver: null,
    intervalId: null, placedLaps: new Set(), activeBadges: []
};

function calcCashoutReturn(bet, car) {
    if (car && car.retired) return 0;
    const pos = car ? car.uiPos : 22;
    const totalLaps = TOTAL_LAPS;
    const currentLap = car ? Math.min(car.currentLap, totalLaps) : 1;
    const lapProgress = Math.max(0.1, currentLap / totalLaps);
    let posMult;
    if (pos === 1) posMult = 1.6;
    else if (pos === 2) posMult = 1.2;
    else if (pos === 3) posMult = 0.95;
    else if (pos <= 5) posMult = 0.7;
    else if (pos <= 8) posMult = 0.5;
    else if (pos <= 12) posMult = 0.35;
    else if (pos <= 16) posMult = 0.2;
    else posMult = 0.1;
    const timeDiscount = 0.4 + lapProgress * 0.5;
    const penalty = bet.windowPenalty || 1.0;
    return Math.max(0, bet.token_amount * posMult * timeDiscount * penalty);
}

function initFastestLapBetSystem() {
    const flBtn = document.getElementById('fl-place-bet-btn');
    const flModal = document.getElementById('fl-bet-modal');
    const flClose = document.getElementById('fl-close-btn');
    const flSubmit = document.getElementById('fl-submit-btn');
    const flGrid = document.getElementById('fl-driver-grid');
    const flAmtInput = document.getElementById('fl-bet-amount');
    const flPreview = document.getElementById('fl-bet-preview');
    const flError = document.getElementById('fl-bet-error');
    const flCountdown = document.getElementById('fl-lap-countdown');
    const flBar = document.getElementById('fl-countdown-bar');
    const flLapBadge = document.getElementById('fl-lap-info-badge');

    let trackedLap = 0;

    setInterval(() => {
        if (!F1Game || F1Game.state !== 'GREEN') { flBtn.disabled = true; return; }
        const loggedIn = AUTH_STATE.token || localStorage.getItem('f1_token');
        if (!loggedIn) { flBtn.disabled = true; return; }
        const topCar = [...F1Game.cars].sort((a, b) => a.uiPos - b.uiPos)[0];
        if (!topCar) { flBtn.disabled = true; return; }
        const lap = topCar.currentLap; const lapFrac = topCar.fraction;

        if (lap > 1 && lap !== trackedLap && lapFrac < 0.08 && !flBetState.placedLaps.has(lap)) {
            trackedLap = lap; openFLWindow(lap);
        }
        if (flBetState.active && !flBetState.placedLaps.has(flBetState.lapNumber)) { flBtn.disabled = false; } else { flBtn.disabled = true; }
    }, 300);

    function openFLWindow(lap) {
        if (flBetState.intervalId) clearInterval(flBetState.intervalId);
        flBetState.active = true; flBetState.lapNumber = lap; flBetState.secondsLeft = 15; flBetState.selectedDriver = null;
        flBetState.intervalId = setInterval(() => {
            flBetState.secondsLeft--;
            if (flModal.classList.contains('show')) { updateFLCountdownUI(); }
            if (flBetState.secondsLeft <= 0) {
                clearInterval(flBetState.intervalId);
                flBetState.active = false; flBtn.disabled = true;
                if (flModal.classList.contains('show')) { flModal.classList.remove('show'); }
            }
        }, 1000);
    }

    function updateFLCountdownUI() {
        const s = flBetState.secondsLeft; flCountdown.textContent = s; flCountdown.className = s <= 5 ? 'urgent' : '';
        const pct = (s / 15) * 100; flBar.style.width = pct + '%'; flBar.style.background = s <= 5 ? 'var(--red)' : 'var(--pink)';
    }

    flBtn.onclick = () => {
        if (!flBetState.active || flBetState.secondsLeft <= 0) return;
        const lap = flBetState.lapNumber;
        flLapBadge.textContent = `LAP ${lap} · 15s WINDOW · WIN = STAKE × 1.5`;
        flGrid.innerHTML = ''; flError.style.display = 'none'; flBetState.selectedDriver = null; flAmtInput.value = ''; flPreview.textContent = '';
        if (typeof DRIVER_DB !== 'undefined') {
            DRIVER_DB.forEach(d => {
                const card = document.createElement('div'); card.className = 'fl-driver-card'; card.dataset.name = d.n;
                let posStr = '';
                if (F1Game && F1Game.cars) { const rc = F1Game.cars.find(c => c.name === d.n); posStr = rc ? `P${rc.uiPos}` : ''; }
                card.innerHTML = `<b>${d.n.toUpperCase()}</b> <span style="color:#555;font-size:9px;">${posStr}</span>`;
                card.onclick = () => {
                    flGrid.querySelectorAll('.fl-driver-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected'); flBetState.selectedDriver = d.n; updateFLPreview();
                };
                flGrid.appendChild(card);
            });
        }
        updateFLCountdownUI(); flModal.classList.add('show');
    };

    flAmtInput.addEventListener('input', updateFLPreview);

    function updateFLPreview() {
        const amt = parseFloat(flAmtInput.value) || 0; const drv = flBetState.selectedDriver;
        if (drv && amt > 0) { flPreview.textContent = `${drv} · ${amt} TKN → WIN ${(amt * 1.5).toFixed(2)} TKN`; flPreview.style.color = 'var(--green)'; } else { flPreview.textContent = ''; }
    }

    flClose.onclick = () => flModal.classList.remove('show');

    flSubmit.onclick = async () => {
        const driver = flBetState.selectedDriver; const amt = parseFloat(flAmtInput.value); const lap = flBetState.lapNumber;
        flError.style.display = 'none';
        if (!driver) { flError.textContent = '⚠ SELECT A DRIVER!'; flError.style.display = 'block'; return; }
        if (!amt || amt <= 0) { flError.textContent = '⚠ ENTER A VALID AMOUNT.'; flError.style.display = 'block'; return; }
        if (flBetState.secondsLeft <= 0) { flError.textContent = '⚠ BETTING WINDOW CLOSED!'; flError.style.display = 'block'; return; }
        const tkn = localStorage.getItem('f1_token');
        flSubmit.textContent = '⏳ PLACING...'; flSubmit.disabled = true;

        try {
            const res = await fetch(`${SERVER_URL}/api/fastest-lap-bet`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tkn}` },
                body: JSON.stringify({ driverName: driver, lapNumber: lap, betAmount: amt })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            AUTH_STATE.tokens = data.newBalance; document.getElementById('display-tokens').textContent = Number(data.newBalance).toFixed(1);
            flBetState.placedLaps.add(lap); flBetState.activeBadges.push({ lap, driver, amount: amt });
            renderFLBadges();

            flError.style.color = 'var(--green)'; flError.textContent = `✔ Bet locked! ${driver} L${lap} · ${amt} TKN`; flError.style.display = 'block';
            setTimeout(() => flModal.classList.remove('show'), 1400);
            if (flBetState.intervalId) clearInterval(flBetState.intervalId);
            flBetState.active = false;
        } catch (err) {
            flError.style.color = 'var(--red)'; flError.textContent = '⚠ ' + err.message; flError.style.display = 'block';
        } finally { flSubmit.textContent = '🔒 LOCK IN BET'; flSubmit.disabled = false; }
    };

    window._lastEvaluatedLap = 0;
    setInterval(async () => {
        if (!F1Game || F1Game.state !== 'GREEN') return;
        const topCar = F1Game.cars ? [...F1Game.cars].sort((a, b) => a.uiPos - b.uiPos)[0] : null; if (!topCar) return;
        const completedLap = topCar.currentLap - 1;
        if (completedLap <= 0 || completedLap <= window._lastEvaluatedLap) return;
        window._lastEvaluatedLap = completedLap;

        const flCar = F1Game.cars.reduce((best, c) => { if (c.bestLap && c.bestLap < (best.bestLap || 99999)) return c; return best; }, {});
        if (!flCar || !flCar.name || flCar.bestLap === Infinity) return;
        const tkn = localStorage.getItem('f1_token'); if (!tkn) return;

        try {
            const res = await fetch(`${SERVER_URL}/api/settle-fastest-lap`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tkn}` },
                body: JSON.stringify({ lapNumber: completedLap, fastestLapDriver: flCar.name })
            });
            const data = await res.json();
            if (res.ok && data.results) {
                const myResult = data.results.find(r => r.username === AUTH_STATE.username);
                if (myResult) {
                    const meRes = await fetch(`${SERVER_URL}/api/me`, { headers: { 'Authorization': `Bearer ${tkn}` } });
                    const meData = await meRes.json();
                    if (meRes.ok) { AUTH_STATE.tokens = meData.tokens; document.getElementById('display-tokens').textContent = Number(meData.tokens).toFixed(1); }
                    if (myResult.won) { showFLToast(`⚡ FASTEST LAP WIN! +${myResult.payout.toFixed(2)} TKN (${myResult.driver} L${completedLap})`); }
                    else { showFLToast(`❌ Fastest lap bet lost — ${myResult.driver} didn't secure it on L${completedLap}`); }
                    flBetState.activeBadges = flBetState.activeBadges.filter(b => b.lap !== completedLap); renderFLBadges();
                }
            }
        } catch (e) { }
    }, 1000);
}

function renderFLBadges() {
    const wrap = document.getElementById('active-bets-display'); if (!wrap) return;
    wrap.querySelectorAll('.fl-active-badge').forEach(b => b.remove());
    flBetState.activeBadges.forEach(b => {
        const badge = document.createElement('span'); badge.className = 'fl-active-badge'; badge.innerHTML = `⚡ ${b.driver.toUpperCase()} L${b.lap} <b>${b.amount}TKN</b>`; wrap.appendChild(badge);
    });
}

let _flToastTimeout;
function showFLToast(msg) {
    let toast = document.getElementById('fl-toast');
    if (!toast) {
        toast = document.createElement('div'); toast.id = 'fl-toast';
        toast.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(13,17,23,0.97);border:1.5px solid var(--pink);color:#fff;font-family:"Orbitron",monospace;font-size:11px;padding:10px 18px;border-radius:6px;z-index:99999;text-align:center;pointer-events:none;transition:opacity 0.3s;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg; toast.style.opacity = '1';
    clearTimeout(_flToastTimeout); _flToastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}

function initBettingSystem() {
    const betBtn = document.getElementById('place-bet-btn'); const cashoutBtn = document.getElementById('cashout-btn');
    const betModal = document.getElementById('bet-modal'); const cashoutModal = document.getElementById('cashout-modal');
    const closeBtn = document.getElementById('close-bet-btn'); const submitBtn = document.getElementById('submit-bet-btn');
    const errorTxt = document.getElementById('bet-error'); const grid = document.getElementById('driver-grid');
    const summaryTxt = document.getElementById('bet-summary'); const activeBetsUI = document.getElementById('active-bets-display');
    const tagsContainer = document.getElementById('selected-drivers-tags'); const countEl = document.getElementById('multi-bet-count');
    const perDriverWrap = document.getElementById('per-driver-amounts'); const driverAmountRows = document.getElementById('driver-amount-rows');

    document.querySelectorAll('.bet-window-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.bet-window-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
            extraLapsWindow = parseInt(btn.dataset.extra || '0');
            const infoEl = document.getElementById('window-info-txt');
            if (infoEl) {
                if (extraLapsWindow === 0) infoEl.textContent = 'Bet before race. Full odds.';
                else if (extraLapsWindow === 1) infoEl.textContent = '+1 Lap window: 15% multiplier reduction.';
                else infoEl.textContent = '+2 Laps window: 30% multiplier reduction. Race already underway.';
            }
            updateBetSummary();
        };
    });

    function getDriverAmount(name) { const inp = document.getElementById(`da-${name}`); return inp ? parseFloat(inp.value) || 0 : 0; }

    function renderPerDriverAmounts() {
        const names = Object.keys(selectedDriversMap);
        if (names.length === 0) { perDriverWrap.style.display = 'none'; return; }
        perDriverWrap.style.display = 'block'; driverAmountRows.innerHTML = '';
        names.forEach(name => {
            const d = selectedDriversMap[name]; const row = document.createElement('div'); row.className = 'driver-amount-row';
            row.innerHTML = `<div class="driver-amount-label">${name.toUpperCase()}</div>
                <input type="number" id="da-${name}" class="driver-amount-input" placeholder="TKN" step="0.5" min="0.5" value="${d.amount || ''}">
                <div class="driver-payout-preview" id="dp-${name}"></div>`;
            driverAmountRows.appendChild(row);

            setTimeout(() => {
                const inp = document.getElementById(`da-${name}`); const prevEl = document.getElementById(`dp-${name}`);
                if (inp && prevEl) {
                    inp.addEventListener('input', () => {
                        const a = parseFloat(inp.value) || 0; const windowPenalty = extraLapsWindow === 0 ? 1.0 : extraLapsWindow === 1 ? 0.85 : 0.70;
                        prevEl.textContent = a > 0 ? `P1→${(a * 2.0 * windowPenalty).toFixed(1)}T` : ''; updateBetSummary();
                    });
                }
            }, 0);
        });
        updateBetSummary();
    }

    function updateTagsUI() {
        if (!tagsContainer || !countEl) return; tagsContainer.innerHTML = ''; const names = Object.keys(selectedDriversMap);
        names.forEach(name => {
            const tag = document.createElement('div'); tag.className = 'sel-driver-tag'; tag.innerHTML = `${name.toUpperCase()} <span class="remove-tag" title="Remove">✕</span>`;
            tag.querySelector('.remove-tag').onclick = (e) => {
                e.stopPropagation(); delete selectedDriversMap[name];
                document.querySelectorAll('.driver-card').forEach(c => { if (c.dataset.name === name) c.classList.remove('selected'); });
                updateTagsUI(); renderPerDriverAmounts(); updateBetSummary();
            };
            tagsContainer.appendChild(tag);
        });
        countEl.textContent = `${names.length}/4 drivers selected`; renderPerDriverAmounts();
    }

    function updateBetSummary() {
        const names = Object.keys(selectedDriversMap); const windowPenalty = extraLapsWindow === 0 ? 1.0 : extraLapsWindow === 1 ? 0.85 : 0.70;
        if (names.length > 0) {
            const total = names.reduce((s, n) => s + getDriverAmount(n), 0);
            if (total > 0) { summaryTxt.textContent = `${names.length} bet(s) · Total: ${total.toFixed(1)} TKN · Window: ${(windowPenalty * 100).toFixed(0)}%`; }
            else { summaryTxt.textContent = 'Enter amounts per driver above'; }
        } else { summaryTxt.textContent = ''; }
    }

    setInterval(() => {
        const loggedIn = AUTH_STATE.token || localStorage.getItem('f1_token');
        if (!loggedIn) { betBtn.style.display = 'none'; cashoutBtn.style.display = 'none'; return; }
        if (!F1Game) return;
        const inPreRace = (F1Game.state === 'GRID_PREP' || F1Game.state === 'GRID_WAIT' || F1Game.state === 'FORMATION');
        const topCar = F1Game.cars ? [...F1Game.cars].sort((a, b) => a.uiPos - b.uiPos)[0] : null;
        const currentLap = topCar ? topCar.currentLap : 0;
        const inEarlyRace = F1Game.state === 'GREEN' && currentLap <= 2;
        const betOpen = inPreRace || inEarlyRace;
        betBtn.style.display = betOpen ? 'block' : 'none';
        const lapsLeft = topCar ? TOTAL_LAPS - topCar.currentLap : 99;
        const cashoutOpen = F1Game.state === 'GREEN' && lapsLeft > 2 && activeBetsCache.length > 0;
        cashoutBtn.style.display = cashoutOpen ? 'block' : 'none';
    }, 500);

    betBtn.onclick = () => {
        if (!F1Game) return;
        const topCar = F1Game.cars ? [...F1Game.cars].sort((a, b) => a.uiPos - b.uiPos)[0] : null;
        const currentLap = topCar ? topCar.currentLap : 0;
        const inPreRace = (F1Game.state === 'GRID_PREP' || F1Game.state === 'GRID_WAIT' || F1Game.state === 'FORMATION');
        const inEarlyRace = F1Game.state === 'GREEN' && currentLap <= 2;
        if (!inPreRace && !inEarlyRace) { showToast('Betting window closed — bets accepted until lap 2', 'warn'); return; }
        if (inEarlyRace) { const btn = document.querySelector(`.bet-window-btn[data-extra="${Math.min(currentLap, 2)}"]`); if (btn) btn.click(); }

        betModal.classList.remove('hidden'); betModal.style.display = 'flex';
        selectedDriversMap = {}; grid.innerHTML = ''; errorTxt.style.display = 'none'; submitBtn.textContent = 'LOCK IN BETS'; updateTagsUI();

        setTimeout(() => {
            if (typeof DRIVER_DB === 'undefined' || DRIVER_DB.length === 0) { grid.innerHTML = '<span style="color:red">ERROR: No driver database found!</span>'; return; }
            DRIVER_DB.forEach(driverInfo => {
                const card = document.createElement('div'); card.className = 'driver-card'; card.dataset.name = driverInfo.n;
                const sortedCars = (F1Game && F1Game.cars) ? [...F1Game.cars].sort((a, b) => (a.bestLap || 999) - (b.bestLap || 999)) : [];
                const gridPos = sortedCars.findIndex(c => c.name === driverInfo.n);
                let posInfo = '';
                if (F1Game.state === 'GREEN' && F1Game.cars) {
                    const raceCar = F1Game.cars.find(c => c.name === driverInfo.n); posInfo = raceCar ? `(Race P${raceCar.uiPos})` : '';
                } else { posInfo = gridPos >= 0 ? `Grid P${gridPos + 1}` : ''; }

                card.innerHTML = `<span style="font-weight:bold; color:#fff">${driverInfo.n.toUpperCase()}</span> <span style="color:#555; font-size:9px;">${posInfo}</span>`;
                card.onclick = () => {
                    const name = driverInfo.n;
                    if (selectedDriversMap[name]) {
                        delete selectedDriversMap[name]; card.classList.remove('selected');
                    } else {
                        if (Object.keys(selectedDriversMap).length >= 4) { errorTxt.textContent = '⚠ Max 4 drivers per bet session!'; errorTxt.style.display = 'block'; return; }
                        selectedDriversMap[name] = { name, multi: 1.0, amount: 0 }; card.classList.add('selected'); errorTxt.style.display = 'none';
                    }
                    updateTagsUI(); updateBetSummary();
                };
                grid.appendChild(card);
            });
        }, 10);
    };

    closeBtn.onclick = () => { betModal.classList.add('hidden'); betModal.style.display = 'none'; };

    submitBtn.onclick = async () => {
        const selectedNames = Object.keys(selectedDriversMap);
        if (selectedNames.length === 0) return showErr('⚠ SELECT AT LEAST ONE DRIVER!');
        const driverAmounts = selectedNames.map(n => ({ name: n, amt: getDriverAmount(n), multi: selectedDriversMap[n].multi }));
        const invalid = driverAmounts.filter(d => !d.amt || d.amt <= 0);
        if (invalid.length > 0) { return showErr(`⚠ Enter stake for: ${invalid.map(d => d.name).join(', ')}`); }

        const windowPenalty = extraLapsWindow === 0 ? 1.0 : extraLapsWindow === 1 ? 0.85 : 0.70;
        const tkn = localStorage.getItem('f1_token'); submitBtn.textContent = 'PLACING BETS...';
        let successCount = 0; let lastBalance = AUTH_STATE.tokens;

        for (const { name: driverName, amt } of driverAmounts) {
            try {
                const res = await fetch(`${SERVER_URL}/api/bet`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tkn}` },
                    body: JSON.stringify({ driverName, betAmount: amt, windowPenalty })
                });
                const data = await res.json(); if (!res.ok) throw new Error(data.message);
                lastBalance = data.newBalance; successCount++;

                const badge = document.createElement('div'); badge.className = 'active-bet-badge'; badge.innerHTML = `🎟️ ${driverName.toUpperCase()} <b>${amt} TKN</b>`;
                activeBetsUI.appendChild(badge); activeBetsCache.push({ driver_name: driverName, token_amount: amt, windowPenalty });
            } catch (err) { showErr(`⚠ ${driverName}: ${err.message}`); }
        }

        if (successCount > 0) {
            document.getElementById('display-tokens').textContent = Number(lastBalance).toFixed(1); AUTH_STATE.tokens = lastBalance;
            localStorage.setItem('f1_has_bet', '1'); showErr(`✔ ${successCount} bet(s) placed!`, 'var(--green)');
            setTimeout(() => closeBtn.onclick(), 1500);
        }
        submitBtn.textContent = 'LOCK IN BETS';
    };

    if (cashoutBtn) {
        cashoutBtn.onclick = () => {
            if (!F1Game || F1Game.state !== 'GREEN') return;
            const topCar = F1Game.cars ? [...F1Game.cars].sort((a, b) => a.uiPos - b.uiPos)[0] : null;
            const lapsLeft = topCar ? TOTAL_LAPS - topCar.currentLap : 99;
            if (lapsLeft <= 2) { showToast('Cashout locked — last 2 laps!', 'warn'); return; }
            const listEl = document.getElementById('cashout-bets-list'); const msgEl = document.getElementById('cashout-msg');
            listEl.innerHTML = ''; msgEl.textContent = '';

            if (activeBetsCache.length === 0) {
                listEl.innerHTML = '<p style="color:#888; font-family:monospace; font-size:11px; text-align:center;">No active bets to cashout.</p>';
            } else {
                activeBetsCache.forEach((bet, idx) => {
                    const car = F1Game.cars ? F1Game.cars.find(c => c.name === bet.driver_name) : null;
                    const returnAmt = calcCashoutReturn(bet, car); const pos = car ? car.uiPos : '?'; const isOut = car && car.retired;
                    const row = document.createElement('div'); row.className = 'cashout-bet-row';

                    if (isOut) {
                        row.innerHTML = `<div><div class="bet-driver" style="text-decoration:line-through; color:var(--red);">${bet.driver_name.toUpperCase()}</div><div class="bet-pos-info" style="color:var(--red);">RETIRED (DNF) · Staked: ${bet.token_amount} TKN</div></div><div style="display:flex; align-items:center; gap:8px;"><span class="bet-return" style="color:var(--red);">↩ 0.00 TKN</span><button class="cashout-execute-btn" disabled style="opacity:0.4; cursor:not-allowed; border-color:#555; color:#555; background:transparent;">OUT</button></div>`;
                    } else {
                        row.innerHTML = `<div><div class="bet-driver">${bet.driver_name.toUpperCase()}</div><div class="bet-pos-info">Current: P${pos} · Staked: ${bet.token_amount} TKN</div></div><div style="display:flex; align-items:center; gap:8px;"><span class="bet-return">↩ ${returnAmt.toFixed(2)} TKN</span><button class="cashout-execute-btn" data-idx="${idx}" data-return="${returnAmt.toFixed(2)}">CASHOUT</button></div>`;
                    }
                    listEl.appendChild(row);
                });
                listEl.querySelectorAll('.cashout-execute-btn:not([disabled])').forEach(btn => {
                    btn.onclick = async () => {
                        const idx = parseInt(btn.dataset.idx); const returnAmt = parseFloat(btn.dataset.return);
                        const bet = activeBetsCache[idx]; if (!bet) return;
                        btn.disabled = true; btn.textContent = '...'; const tkn = localStorage.getItem('f1_token');
                        try {
                            const res = await fetch(`${SERVER_URL}/api/cashout`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tkn}` },
                                body: JSON.stringify({ driverName: bet.driver_name, returnAmount: returnAmt })
                            });
                            const data = await res.json(); if (!res.ok) throw new Error(data.message);
                            AUTH_STATE.tokens = data.newBalance; document.getElementById('display-tokens').textContent = data.newBalance.toFixed(1);
                            msgEl.style.color = 'var(--green)'; msgEl.textContent = `✔ Cashed out ${returnAmt.toFixed(2)} TKN for ${bet.driver_name}!`;
                            activeBetsCache.splice(idx, 1); setTimeout(() => cashoutBtn.onclick(), 500);
                        } catch (err) { msgEl.style.color = 'var(--red)'; msgEl.textContent = '⚠ ' + err.message; btn.disabled = false; btn.textContent = 'CASHOUT'; }
                    };
                });
            }
            cashoutModal.classList.remove('hidden');
        };
    }
    function showErr(msg, col = 'var(--red)') { errorTxt.textContent = msg; errorTxt.style.color = col; errorTxt.style.display = 'block'; }
}

window.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initBuyTokens();
    initLogout();
    initBettingSystem();
    initFastestLapBetSystem();
});

const _origUpdateUI = window.__betSyncDone;
if (!_origUpdateUI) {
    window.__betSyncDone = true;
}