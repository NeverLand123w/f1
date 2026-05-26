class FailureCascadeSystem {
    constructor() {
        this.activeCascades = [];
        this.alertEl = document.getElementById('cascade-alert');
        this.typeEl = document.getElementById('cascade-type');
        this.chainEl = document.getElementById('cascade-chain');
        this.flashTimer = 0;
    }
    initCascade(car, type) {
        if (this.activeCascades.find(c => c.car === car && c.type === type)) return;
        this.activeCascades.push({ car, type, stage: 0, timer: 180 + Math.random() * 120 });
    }
    update(dt, gameEngine) {
        this.flashTimer -= dt;
        if (this.flashTimer <= 0 && this.alertEl) this.alertEl.classList.remove('show');
        this.activeCascades = this.activeCascades.filter(casc => {
            casc.timer -= dt;
            if (casc.timer <= 0) {
                casc.stage++;
                const chain = CASCADE_CHAINS[casc.type];
                if (!chain || casc.stage >= chain.length) {
                    if (casc.type === 'thermal' || casc.type === 'gearbox') {
                        casc.car.retired = true; casc.car.dnfType = casc.type.toUpperCase();
                        casc.car.smokeColor = casc.type === 'thermal' ? '#222' : '#888';
                        if (gameEngine) { gameEngine.setFlag('SC', 1800); gameEngine.addFIAMessage(`${casc.car.name} - ${casc.type.toUpperCase()} FAILURE - RETIRED`, 'dnf-text'); }
                    } else {
                        casc.car.hasWingDamage = true;
                    }
                    if (this.alertEl && this.typeEl && this.chainEl) {
                        this.typeEl.textContent = chain ? chain[chain.length - 1] : 'SYSTEM FAILURE';
                        this.chainEl.textContent = casc.car.name + ' · ' + casc.type.toUpperCase();
                        this.alertEl.classList.add('show'); this.flashTimer = 120;
                    }
                    return false;
                }
                casc.timer = 200 + Math.random() * 200;
                if (casc.type === 'hydraulic') casc.car.bumpShake = Math.max(casc.car.bumpShake, casc.stage * 3);
                if (casc.type === 'gearbox') casc.car.shiftTimer = Math.max(casc.car.shiftTimer, casc.stage * 20);
                if (casc.type === 'thermal') casc.car.speed *= Math.pow(1 - casc.stage * 0.004, dt);
                if (this.alertEl && this.typeEl && this.chainEl) {
                    this.typeEl.textContent = chain[casc.stage];
                    this.chainEl.textContent = casc.car.name + ' · Stage ' + (casc.stage + 1) + '/' + chain.length;
                    this.alertEl.classList.add('show'); this.flashTimer = 80;
                }
                return true;
            }
            return true;
        });
    }
}

class CameraDirector {
    constructor(canvas) {
        this.x = 0; this.y = 0; this.angle = 0; this.zoom = 0.5; this.shakeX = 0; this.shakeY = 0;
        this.mode = 'tv'; this.focusTargetId = null;
        this.lastTargetId = null;
        this.canvas = canvas;
        this.autoDirActive = true; this.dirLockTime = 0; this.currentPriority = 0;
    }
    setTarget(id) { this.focusTargetId = id; this.autoDirActive = false; }
    setMode(mode) {
        if (mode === 'auto') { this.autoDirActive = true; this.dirLockTime = 0; return; }
        this.mode = mode; this.autoDirActive = false;
    }
    forceEventCut(carId, priority, type, lockFrames) {
        if (!this.autoDirActive) return;
        if (this.dirLockTime > 0 && priority <= this.currentPriority) return;

        this.focusTargetId = carId;
        this.currentPriority = priority;
        this.dirLockTime = lockFrames;

        if (['crash', 'spin', 'puncture', 'engine', 'wing'].includes(type)) { this.mode = Math.random() < 0.4 ? 'heli' : (Math.random() < 0.6 ? 'tv' : 'chase'); }
        else if (type === 'overtake') { this.mode = Math.random() < 0.5 ? 'tv' : 'chase'; }
        else if (type === 'pit') { this.mode = 'pitlane'; }
        else if (type === 'lockup') { this.mode = Math.random() < 0.5 ? 'chase' : 'tv'; }
        else if (type === 'start') { this.mode = Math.random() < 0.6 ? 'heli' : 'tv'; }
        else if (type === 'fastestLap') { this.mode = Math.random() < 0.7 ? 'onboard' : 'tv'; }
        else { this.mode = 'tv'; }
    }
    findAmbientShot(cars) {
        this.currentPriority = 0;
        this.dirLockTime = 250 + Math.random() * 400;

        let activeCars = cars.filter(c => !c.retired && !c.inPitPhase && !c.finishedRace);
        if (activeCars.length === 0) activeCars = cars.filter(c => !c.retired);
        if (activeCars.length === 0) activeCars = cars;

        let sorted = [...activeCars].sort((a, b) => a.uiPos - b.uiPos);
        let target = sorted[0];

        let battlers = sorted.filter(c => c.overtakeState && c.overtakeState.committed);
        if (battlers.length > 0 && Math.random() < 0.85) { target = battlers[Math.floor(Math.random() * battlers.length)]; }
        else if (Math.random() < 0.75) {
            for (let i = 0; i < sorted.length - 1; i++) {
                let gap = sorted[i].dist - sorted[i + 1].dist;
                if (gap > 0 && gap < 0.035) { target = sorted[i + 1]; break; }
            }
        } else if (Math.random() < 0.3) { target = sorted[Math.floor(Math.random() * Math.min(6, sorted.length))]; }

        if (target) this.focusTargetId = target.id;
        const modes = ['tv', 'tv', 'chase', 'chase', 'onboard', 'heli'];
        this.mode = (target && target.inPitPhase > 0) ? 'pitlane' : modes[Math.floor(Math.random() * modes.length)];
    }
    update(cars, dt) {
        if (this.autoDirActive) {
            this.dirLockTime -= dt;
            if (this.dirLockTime <= 0) this.findAmbientShot(cars);
        }
        if (this.focusTargetId === null && cars.length > 0) this.focusTargetId = cars[0].id;
        const targetCar = cars.find(c => c.id === this.focusTargetId) || cars[0];
        if (!targetCar) return;

        let sfX, sfY, sfA, tZoom;
        let fovMod = (targetCar.displayKmh / 360) * 0.3;

        switch (this.mode) {
            case 'onboard': sfX = 0.5; sfY = 0.5; sfA = 0.4; tZoom = 2.4 - fovMod; break;
            case 'chase': sfX = 0.2; sfY = 0.2; sfA = 0.2; tZoom = 1.4 - fovMod; break;
            case 'tv': sfX = 0.07; sfY = 0.07; sfA = 0.1; tZoom = 1.15; break;
            case 'pitlane': sfX = 0.1; sfY = 0.1; sfA = 0.1; tZoom = 1.8; break;
            case 'heli': sfX = 0.05; sfY = 0.05; sfA = 0.05; tZoom = 0.45; break;
            default: sfX = 0.08; sfY = 0.08; sfA = 0.05; tZoom = 0.9;
        }

        this.zoom += (tZoom - this.zoom) * 0.05 * dt;

        if (this.lastTargetId !== targetCar.id) {
            this.x = targetCar.x; this.y = targetCar.y; this.angle = targetCar.tangAngle;
            this.lastTargetId = targetCar.id;
        } else {
            this.x += (targetCar.x - this.x) * Math.min(1, sfX * 1.5 * dt);
            this.y += (targetCar.y - this.y) * Math.min(1, sfY * 1.5 * dt);
            let dAng = targetCar.tangAngle - this.angle; dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng));
            this.angle += dAng * Math.min(1, sfA * 1.5 * dt);
        }

        this.shakeX *= Math.pow(0.72, dt); this.shakeY *= Math.pow(0.72, dt);
        if (this.mode === 'onboard' || this.mode === 'chase') {
            const speedRumble = Math.min(1.2, targetCar.displayKmh / 280);
            const eventKick = Math.min(2.0, (targetCar.bumpShake || 0) * 0.18 + (targetCar.collisionShake || 0) * 0.12 + (targetCar.isPorpoising ? 0.8 : 0) + (targetCar.isBottomingOut ? 0.5 : 0) + (Math.abs(targetCar.laneOffset) > 1.2 ? 0.6 : 0));
            const totalRumble = speedRumble + eventKick;
            const gSway = (targetCar.lateralG || 0) * 0.25;
            const gNod = (targetCar.longitudinalG || 0) * 0.12;
            this.shakeX += (Math.random() - 0.5) * totalRumble + gSway;
            this.shakeY += (Math.random() - 0.5) * totalRumble + gNod;
            this.shakeX = Math.max(-4, Math.min(4, this.shakeX));
            this.shakeY = Math.max(-4, Math.min(4, this.shakeY));
        }
    }
    applyTransform(ctx) {
        ctx.save();
        ctx.translate(this.canvas.width / 2 + this.shakeX, this.canvas.height / 2 + this.shakeY);
        let effectiveZoom = (F1Game && F1Game.cinematicZoom && (this.mode === 'tv' || this.mode === 'chase')) ? F1Game.cinematicZoom : this.zoom;
        ctx.scale(effectiveZoom, effectiveZoom);
        if (this.mode === 'onboard' || this.mode === 'chase') {
            let yOff = this.mode === 'chase' ? 80 : 0;
            ctx.translate(0, yOff); ctx.rotate(-this.angle - Math.PI / 2);
        }
        ctx.translate(-this.x, -this.y);
    }
    restore(ctx) { ctx.restore(); }
}

class AudioEngine {
    constructor() {
        this.voiceEnabled = true; this.commentaryQueue = []; this.radioQueue = [];
        this.isSpeaking = false; this._audioCtx = null; this._radioFilterNodes = null;
    }
    toggleVoice() {
        this.voiceEnabled = !this.voiceEnabled; const btn = document.getElementById('voice-toggle');
        if (!btn) return; btn.textContent = this.voiceEnabled ? '🔊 VOICE ON' : '🔇 MUTED'; btn.className = this.voiceEnabled ? 'voice-btn' : 'voice-btn muted';
        if (!this.voiceEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
    }
    speakText(text, cfg, type = 'commentary') {
        if (!this.voiceEnabled || !window.speechSynthesis) return;
        if (type === 'radio') { this.radioQueue.push({ text, cfg, type }); }
        else { this.commentaryQueue.push({ text, cfg, type }); }
        if (!this.isSpeaking) this._processNext();
    }
    _processNext() {
        const queue = this.commentaryQueue.length > 0 ? this.commentaryQueue : this.radioQueue;
        if (queue.length === 0) { this.isSpeaking = false; return; }
        this.isSpeaking = true; const item = queue.shift(); this._speak(item);
    }
    _buildRadioFilterChain() {
        try { if (!this._audioCtx) { this._audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } } catch (e) { }
    }
    _playRadioStatic(durationMs) {
        if (!this._audioCtx) return;
        try {
            const ctx = this._audioCtx; if (ctx.state === 'suspended') ctx.resume();
            const bufLen = Math.ceil(ctx.sampleRate * (durationMs / 1000));
            const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate); const data = buf.getChannelData(0);
            for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * 0.06;
            const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;
            const gain = ctx.createGain(); gain.gain.setValueAtTime(0.0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05); gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + (durationMs / 1000) - 0.1); gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + (durationMs / 1000));
            const src = ctx.createBufferSource(); src.buffer = buf; src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
            src.start(); src.stop(ctx.currentTime + durationMs / 1000);
        } catch (e) { }
    }
    _speak(item) {
        const { text, cfg, type } = item; const isRadio = type === 'radio';
        const utter = new SpeechSynthesisUtterance(text); const voices = window.speechSynthesis.getVoices(); let chosen = null;
        if (isRadio) {
            const radioVoicePrefs = ['Microsoft Christopher Online (Natural)', 'Microsoft Sonia Online (Natural)', 'Google UK English Male', 'Microsoft Mark', 'Alex', 'Daniel'];
            for (const name of radioVoicePrefs) { chosen = voices.find(v => v.name.toLowerCase().includes(name.toLowerCase())); if (chosen) break; }
            if (!chosen) chosen = voices.find(v => v.lang.startsWith('en'));
            utter.voice = chosen || voices[0]; utter.rate = 0.95; utter.pitch = 0.60;
            const estDuration = Math.max(1500, text.split(' ').length * 130 + 400); this._buildRadioFilterChain(); utter.onstart = () => this._playRadioStatic(estDuration);
        } else {
            for (const name of cfg.voiceName) { chosen = voices.find(v => v.name.toLowerCase().includes(name.toLowerCase())); if (chosen) break; }
            utter.voice = chosen || voices.find(v => v.lang.startsWith('en')) || voices[0]; utter.rate = cfg.voiceRate; utter.pitch = cfg.voicePitch;
        }
        const gap = isRadio ? 500 : 200;
        utter.onend = () => setTimeout(() => this._processNext(), gap);
        utter.onerror = () => this._processNext();
        window.speechSynthesis.speak(utter);
    }
}

class BroadcastDirector {
    constructor(audioEngine) {
        this.audio = audioEngine; this.isGenerating = false; this.lastTime = 0; this.lastSpeaker = 'brundle';
        this.personas = {
            croft: { name: 'David Croft', avatar: 'DC', cls: 'croft', voiceRate: 1.15, voicePitch: 1.15, voiceName: ['Microsoft Ryan Online (Natural)', 'Microsoft Ryan', 'Daniel', 'Google UK English Male', 'en-GB'] },
            brundle: { name: 'Martin Brundle', avatar: 'MB', cls: 'brundle', voiceRate: 1.05, voicePitch: 0.90, voiceName: ['Microsoft Thomas Online (Natural)', 'Microsoft Guy Online (Natural)', 'Alex', 'Google US English Male', 'en-US'] }
        };
    }
    addMessage(persona, text, showTyping = false) {
        const feed = document.getElementById('comm-feed'); if (!feed) return null;
        const cfg = this.personas[persona];
        Array.from(feed.children).forEach((el, i) => { if (i > 0) el.classList.add('fading'); });
        const msg = document.createElement('div'); msg.className = 'comm-msg';
        msg.innerHTML = `<div class="comm-body"><div class="comm-name ${cfg.cls}">${cfg.name.toUpperCase()}</div><div class="comm-text">${showTyping ? `<span class="comm-typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>` : text}</div></div>`;
        feed.prepend(msg);
        while (feed.children.length > 8) feed.removeChild(feed.lastChild);
        return msg;
    }
    triggerEvent(event) {
        const now = Date.now(); if (now - this.lastTime < 4500 || this.isGenerating) return;
        let ctxStr = ""; let pFailovers = [];
        if (event.type === 'start') { ctxStr = "Race Start! The lights go out!"; pFailovers = ["It's lights out and away we go!"]; }
        else if (event.type === 'formation') { ctxStr = "The formation lap is underway as cars pull off the grid to weave heat into their tyres!"; pFailovers = ["Formation lap begins, time to build some temperature!"]; }
        else if (event.type === 'jump_start') { ctxStr = `Unbelievable! ${event.car.name} just jumped the start before the lights went out! 10 second penalty!`; pFailovers = [`Massive mistake! ${event.car.name} gets a penalty for a false start!`, `Oh no, ${event.car.name} couldn't wait for the lights!`]; }
        else if (event.type === 'stall') { ctxStr = `Disaster off the line for ${event.car.name}, they bogged down terribly!`; pFailovers = [`Oh, terrible start from ${event.car.name}, getting swallowed by the pack!`, `Anti-stall kicked in for ${event.car.name} on the grid!`]; }
        else if (event.type === 'q_start') { ctxStr = "Qualifying is Go! Cars leave the pits for the shootout!"; pFailovers = ["The Q1 Shootout is officially underway!"]; }
        else if (event.type === 'q_pole') { ctxStr = `${event.car.name} just set a blazing provisional pole position lap!`; pFailovers = [`Massive lap from ${event.car.name}, straight to P1!`, `Purple sectors for ${event.car.name}, they take provisional Pole!`]; }
        else if (event.type === 'q_end') { ctxStr = "Qualifying is over! That sets the grid, race is about to start!"; pFailovers = ["The grid is set! What a spectacular qualifying shootout!"]; }
        else if (event.type === 'overtake' && event.carA && event.carB) { ctxStr = `Brilliant racing! ${event.carA.name} lunges past ${event.carB.name} into P${event.pos}!`; pFailovers = [`What a move! ${event.carA.name} passes ${event.carB.name} for P${event.pos}!`, `Down the inside goes ${event.carA.name} ahead of ${event.carB.name}!`, `${event.carA.name} completes a magnificent overtake on ${event.carB.name}!`]; }
        else if (event.type === 'collision' && event.carA && event.carB) { ctxStr = `Huge drama! ${event.carA.name} and ${event.carB.name} have collided heavily on track!`; pFailovers = [`Absolute chaos! ${event.carA.name} and ${event.carB.name} make heavy contact!`, `Disaster! ${event.carA.name} crashes right into ${event.carB.name}! Carbon fibre everywhere!`]; }
        else if (event.type === 'penalty') { ctxStr = `The stewards have handed a ${event.amount} second penalty to ${event.car.name} for ${event.penaltyReason}!`; pFailovers = [`A penalty is given! ${event.car.name} gets ${event.amount} seconds for ${event.penaltyReason}!`, `News from the stewards: ${event.amount} second time penalty for ${event.car.name}!`]; }
        else if (event.type === 'pit') { ctxStr = `${event.car.name} enters the pits!`; pFailovers = [`Strategy call! ${event.car.name} dives into the pit lane!`, `We see ${event.car.name} heading into the pit box for a fresh set of tyres!`]; }
        else if (event.type === 'undercut') { ctxStr = `Huge strategy call, ${event.car.name} pits attempting the undercut!`; pFailovers = [`They're going for the undercut! ${event.car.name} into the box!`, `Early stop for ${event.car.name}! Looking for clean air!`]; }
        else if (event.type === 'sc_pit') { ctxStr = `${event.car.name} is diving in under the safety car for a cheap pit stop!`; pFailovers = [`Smart strategy, ${event.car.name} takes advantage of the flags to stop!`, `They dive into the pits for a heavily discounted tire change!`]; }
        else if (event.type === 'spin') { ctxStr = `OH NO! ${event.car.name} HAS SPUN! YELLOW FLAGS!`; pFailovers = [`Disaster! ${event.car.name} loses the rear end entirely!`, `${event.car.name} is facing the wrong way!`]; }
        else if (event.type === 'weather') { ctxStr = `WEATHER UPDATE: Race control signals ${event.weather} conditions! Track grip changing!`; pFailovers = [`Looks like the weather is changing! ${event.weather} out there now!`, `Umbrellas are going up as ${event.weather} hits the track!`]; }
        else if (event.type === 'engine') { ctxStr = `${event.car.name}'s ENGINE HAS BLOWN! SAFETY CAR!`; pFailovers = [`Total engine failure for ${event.car.name}! Smoke billowing out!`, `Catastrophe for ${event.car.name}! Their car gives up the ghost!`]; }
        else if (event.type === 'lockup') { ctxStr = `${event.car.name} with a massive lockup under braking, smoking those tyres!`; pFailovers = [`Huge lockup from ${event.car.name} into the heavy braking zone!`, `Lots of tyre smoke from ${event.car.name}! That will cause a nasty flat spot!`]; }
        else if (event.type === 'wing') { ctxStr = `Carbon fibre flies as ${event.car.name} breaks a front wing! VSC deployed!`; pFailovers = [`${event.car.name} has serious front wing damage! The Virtual Safety Car is out!`, `Debris scattered all over the track from ${event.car.name}! VSC deployed!`]; }
        else if (event.type === 'puncture') { ctxStr = `Oh no, ${event.car.name} has suffered a puncture! They are crawling back to the pits.`; pFailovers = [`Heartbreak for ${event.car.name} with a blown tyre!`, `You can see sparks flying! ${event.car.name} is limping back with a flat tyre!`]; }
        else if (event.type === 'vsc_in') { ctxStr = "Virtual Safety Car is ending!"; pFailovers = ["VSC Ending, drop the hammer!"]; }
        else if (event.type === 'sc_in') { ctxStr = "Safety car in this lap!"; pFailovers = ["Safety Car is returning to the pits! Green flag imminent!"]; }
        else if (event.type === 'dry') { ctxStr = "The track is getting rubbered back in! Lap times will fall fast!"; pFailovers = ["Racing line is beautifully rubbered up now!"]; }
        else if (event.type === 'fastestLap') { ctxStr = `${event.car.name} just slammed in the fastest lap of the race!`; pFailovers = [`Purple sectors across the board! ${event.car.name} claims the fastest lap!`, `Incredible pace from ${event.car.name}, resetting the fastest lap benchmark!`]; }
        else if (event.type === 'finish') { ctxStr = `${event.car.name} wins the grand prix!`; pFailovers = [`Absolutely spectacular drive, ${event.car.name} takes the chequered flag!`] }
        else { return; }

        this.lastTime = now; this.isGenerating = true;
        const s1 = this.lastSpeaker === 'croft' ? 'brundle' : 'croft'; this.lastSpeaker = s1;
        const firstMsg = this.addMessage(s1, '', true);
        if (!firstMsg) { this.isGenerating = false; return; }

        const keyInput = document.getElementById('claude-key');
        const apiKey = keyInput ? keyInput.value.trim() : '';

        if (!apiKey) {
            let ftxt = pFailovers[Math.floor(Math.random() * pFailovers.length)];
            if (firstMsg.querySelector('.comm-text')) firstMsg.querySelector('.comm-text').textContent = ftxt;
            this.audio.speakText(ftxt, this.personas[s1], 'commentary');
            this.isGenerating = false; return;
        }
        (async () => {
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ systemInstruction: { parts: [{ text: `You are legendary F1 commentator ${this.personas[s1].name}. Extremely hype, energetic, live TV broadcast style. React exactly to the prompt, mentioning specific driver names. Describe WHO passed WHO or WHO crashed into WHO based exactly on the provided context. Limit response to EXACTLY ONE punchy, dramatic sentence. No quotes, no asterisks.` }] }, contents: [{ parts: [{ text: ctxStr }] }], generationConfig: { temperature: 0.85, maxOutputTokens: 60 } })
                });
                const j = await res.json(); let t1 = j.candidates[0].content.parts[0].text.replace(/["*#]/g, '').trim();
                if (firstMsg.querySelector('.comm-text')) firstMsg.querySelector('.comm-text').textContent = t1;
                this.audio.speakText(t1, this.personas[s1], 'commentary');
            } catch (e) {
                if (firstMsg.querySelector('.comm-text')) firstMsg.querySelector('.comm-text').textContent = pFailovers[0];
                this.audio.speakText(pFailovers[0], this.personas[s1], 'commentary');
            }
            finally { this.isGenerating = false; }
        })();
    }
}

class DriverRadio {
    constructor(audioEngine) {
        this.audio = audioEngine;
        this.messages = {
            fuel: [
                c => `${c.name}, fuel's looking good. About ${c.fuelLoad.toFixed(1)} kilos remaining, you can push.`,
                c => `${c.name}, we need you to save a little fuel. Lift and coast into Turn 4.`,
                c => `${c.name}, copy on fuel mode. Switch to mix 3, back off a touch.`,
                c => `${c.name}, you're burning more than expected. Lift and coast sectors two and three.`,
            ],
            tyres: [
                c => `${c.name}, front left is starting to go. Manage it over the next two laps.`,
                c => `${c.name}, box box box. We're bringing you in this lap. Mediums going on.`,
                c => `${c.name}, tyre temps look good. Push now, push now.`,
                c => `${c.name}, watch the rear deg in the high-speed sections. You're losing time there.`,
            ],
            position: [
                (c, g) => `${c.name}, car ahead is ${g}. Gap is ${(Math.random() * 2 + 0.5).toFixed(1)} seconds. Let's close it down.`,
                c => `${c.name}, you've got DRS in the zone. Overlap him in turn 3.`,
                c => `${c.name}, car behind closing rapidly. Defend your position.`,
                c => `${c.name}, P${c.uiPos} confirmed. Consistent laps, bring it home.`,
            ],
            weather: [
                c => `${c.name}, rain radar shows a front approaching. Stay on slicks for now.`,
                c => `${c.name}, track is drying rapidly. Box this lap, we go to inters.`,
                c => `${c.name}, be careful through sector one. Some damp patches reported.`,
            ],
            sc: [
                c => `${c.name}, safety car is out. Full delta. Manage the gap to the car ahead.`,
                c => `${c.name}, safety car ending next lap. Get those tyres back up to temperature.`,
                c => `${c.name}, box box box under safety car. Clean stop. Hards going on.`,
            ],
            motivation: [
                c => `${c.name}, fantastic lap! Purple in sector two. Keep pushing like that!`,
                c => `${c.name}, that's the pace! You're pulling away, brilliant.`,
                c => `${c.name}, all good, all good. P${c.uiPos} looks very strong from here.`,
            ]
        };
        this.lastRadioTime = 0;
        this.cooldown = 18000;
        this.box = document.getElementById('radio-box');
        this.textEl = document.getElementById('radio-text');
        this.driverEl = document.getElementById('radio-driver');
        this.hideTimer = null;
    }
    trigger(type, car, extra = {}) {
        const now = Date.now();
        if (now - this.lastRadioTime < this.cooldown) return;
        this.lastRadioTime = now;

        const pool = this.messages[type]; if (!pool) return;
        const fn = pool[Math.floor(Math.random() * pool.length)];
        const text = fn(car, extra.gap || '');

        if (this.box) this.box.classList.add('active');
        if (this.driverEl) this.driverEl.textContent = `→ ${car.name}`;
        if (this.textEl) this.textEl.textContent = '';

        let i = 0;
        const typeWriter = setInterval(() => {
            if (this.textEl) this.textEl.textContent = text.slice(0, i + 1);
            i++;
            if (i >= text.length) clearInterval(typeWriter);
        }, 28);

        if (this.audio) this.audio.speakText(text, {}, 'radio');
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => { if (this.box) this.box.classList.remove('active'); }, 6000);
    }
}

class DeltaSystem {
    constructor() {
        this.sessionBestSectorTimes = [Infinity, Infinity, Infinity];
        this.fillEl = document.getElementById('delta-fill');
        this.valEl = document.getElementById('delta-val');
    }
    update(car, state) {
        if (state === 'FORMATION' || state === 'GRID_WAIT' || state === 'GRID') return;
        for (let i = 0; i < 3; i++) {
            const el = document.getElementById('msec-' + i);
            if (!el) continue;
            if (i > car.currentSector) { el.className = 'mini-sec'; continue; }
            const st = car.sectorTimes[i];
            if (st <= 0) { el.className = 'mini-sec'; continue; }
            if (st < this.sessionBestSectorTimes[i]) {
                this.sessionBestSectorTimes[i] = st;
                el.className = 'mini-sec purple';
            } else if (car.bestLap !== Infinity && st < (car.bestLap / 3 * 0.98)) { el.className = 'mini-sec green'; }
            else { el.className = 'mini-sec yellow'; }
        }

        if (!this.fillEl || !this.valEl) return;
        const lapTime = car.sectorTimes[0] + car.sectorTimes[1] + car.sectorTimes[2];
        const ref = car.bestLap === Infinity ? 90 : car.bestLap;
        const elapsed = lapTime;
        const fracDone = car.fraction;
        const expectedAtFrac = ref * fracDone;
        const delta = elapsed - expectedAtFrac;

        const clamped = Math.max(-2, Math.min(2, delta));
        const pct = (clamped + 2) / 4 * 100;
        if (clamped >= 0) {
            this.fillEl.style.left = '50%';
            this.fillEl.style.width = Math.min(50, pct - 50) + '%';
            this.fillEl.style.background = '#e10600';
            this.valEl.style.color = '#e10600';
            this.valEl.textContent = '+' + Math.abs(delta).toFixed(3);
        } else {
            this.fillEl.style.left = Math.max(0, pct) + '%';
            this.fillEl.style.width = (50 - Math.max(0, pct)) + '%';
            this.fillEl.style.background = '#00d2be';
            this.valEl.style.color = '#00d2be';
            this.valEl.textContent = '-' + Math.abs(delta).toFixed(3);
        }
    }
}

class StewardSystem {
    constructor() {
        this.investigations = [];
        this.overlay = document.getElementById('steward-overlay');
        this.msgEl = document.getElementById('steward-msg');
        this.verdictEl = document.getElementById('steward-verdict');
    }
    investigate(type, car1, car2, gameEngine) {
        const now = Date.now();
        if (this.investigations.find(i => i.time > now - 15000 && i.car1 === car1.id)) return;
        this.investigations.push({ type, car1: car1.id, car2: car2?.id, time: now });

        let msg = '', verdict = '', delay = 4000 + Math.random() * 6000;

        if (type === 'collision') {
            recordOffense(car1.name, 'collision'); let priorCount = getOffenseCount(car1.name, 'collision');
            let blameChance = car1.aggression * 0.55 + (priorCount > 1 ? 0.2 : 0);
            let blamed = Math.random() < blameChance ? car1 : (car2 || car1);
            let penalty = priorCount >= 2 ? 10 : (Math.random() < 0.5 ? 5 : 10);
            msg = `Collision between ${car1.name} and ${car2?.name || 'car'}.\nInvestigating.`;
            verdict = Math.random() < (0.65 + (priorCount > 1 ? 0.2 : 0)) ? `PENALTY: ${blamed.name} — ${penalty}s` : `NO FURTHER ACTION`;
            if (verdict.includes('PENALTY')) {
                setTimeout(() => {
                    blamed.timePenalty += penalty;
                    if (gameEngine) { gameEngine.addFIAMessage(`${penalty}s PENALTY - ${blamed.name}`, 'sc-text'); if (gameEngine.broadcast) gameEngine.broadcast.triggerEvent({ type: 'penalty', car: blamed, amount: penalty, penaltyReason: 'causing a collision' }); }
                }, delay);
            }
        }

        setTimeout(() => {
            if (this.overlay && this.msgEl && this.verdictEl) {
                this.msgEl.textContent = msg; this.verdictEl.textContent = ''; this.overlay.classList.add('show');
                setTimeout(() => { if (this.verdictEl) this.verdictEl.textContent = verdict; setTimeout(() => { this.overlay.classList.remove('show'); }, 4000); }, 2000);
            }
        }, 500);
    }
    updateDriveThroughs(cars, state, gameEngine) {
        const car = cars.find(c => c.id === (gameEngine?.camera?.focusTargetId ?? -1));
        const dtEl = document.getElementById('drive-through-timer');
        if (dtEl && car && car.driveThrough) {
            dtEl.style.display = 'block'; dtEl.textContent = `SERVE DRIVE-THROUGH · ${car.name}`;
        } else if (dtEl) { dtEl.style.display = 'none'; }
        cars.forEach(c => {
            if (c.driveThrough && c.inPitPhase === 2) {
                c.driveThrough = false; c.pitTimer = Math.max(c.pitTimer, 25);
                if (gameEngine) gameEngine.addFIAMessage(`${c.name} SERVES DRIVE-THROUGH PENALTY`);
            }
        });
    }
}

class TelemetryGraph {
    constructor() {
        this.canvas = document.getElementById('telgraph-canvas'); this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.visible = false; this.maxSamples = 280;
    }
    toggle() { this.visible = !this.visible; const wrap = document.getElementById('telemetry-graph-wrap'); if (wrap) wrap.classList.toggle('show', this.visible); }
    update(car) {
        if (!this.visible || !this.ctx || !car) return;
        if (!car.telHistory) car.telHistory = { thr: [], brk: [], rpm: [], spd: [] };
        car.telHistory.thr.push(car.throttlePercent); car.telHistory.brk.push(car.brakeActive ? 1 : 0);
        car.telHistory.rpm.push((car.rpm - 4000) / 8000); car.telHistory.spd.push(car.displayKmh / 360);

        ['thr', 'brk', 'rpm', 'spd'].forEach(k => { if (car.telHistory[k].length > this.maxSamples) car.telHistory[k].shift(); });

        const W = this.canvas.width, H = this.canvas.height; const ctx = this.ctx;
        ctx.clearRect(0, 0, W, H); ctx.fillStyle = 'rgba(6,8,14,0.95)'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#1a2535'; ctx.lineWidth = 1;
        [0.25, 0.5, 0.75].forEach(y => { ctx.beginPath(); ctx.moveTo(0, H * y); ctx.lineTo(W, H * y); ctx.stroke(); });

        const drawTrace = (data, color, offset = 0) => {
            if (data.length < 2) return; ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
            data.forEach((v, i) => {
                let x = (i / this.maxSamples) * W; let y = H - (v * (H * 0.85) + offset) - 4;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }); ctx.stroke();
        };
        drawTrace(car.telHistory.thr, '#00d2be'); drawTrace(car.telHistory.brk, '#e10600'); drawTrace(car.telHistory.rpm, '#ffd700'); drawTrace(car.telHistory.spd, '#0067ff');

        const leg = [['THR', '#00d2be'], ['BRK', '#e10600'], ['RPM', '#ffd700'], ['SPD', '#0067ff']];
        leg.forEach(([lbl, col], i) => { ctx.fillStyle = col; ctx.font = '9px Orbitron, monospace'; ctx.fillText(lbl, 5 + i * 68, 10); });
    }
}

class ChampionshipSystem {
    constructor() { this.points = {}; this.visible = false; this.panel = document.getElementById('championship-panel'); this.body = document.getElementById('champ-body'); }
    toggle() { this.visible = !this.visible; if (this.panel) this.panel.classList.toggle('show', this.visible); }
    awardPoints(finishOrder, cars) {
        finishOrder.forEach((car, idx) => { if (!car || car.retired) return; let pts = F1_POINTS[idx] || 0; this.points[car.name] = (this.points[car.name] || 0) + pts; });
        let fl = cars.filter(c => !c.retired && c.bestLap < Infinity).sort((a, b) => a.bestLap - b.bestLap)[0];
        if (fl) this.points[fl.name] = (this.points[fl.name] || 0) + 1;
        this.updateUI(cars);
    }
    updateUI(cars) {
        if (!this.body || !cars) return;
        let sorted = Object.entries(this.points).sort((a, b) => b[1] - a[1]).slice(0, 10);
        this.body.innerHTML = '';
        sorted.forEach(([name, pts], i) => {
            let car = cars.find(c => c.name === name); let color = car ? car.color : '#888'; let row = document.createElement('div'); row.className = 'champ-row';
            row.innerHTML = `<span style="font-family:'Orbitron',monospace;font-size:9px;color:#666;width:14px">${i + 1}</span><span class="champ-dot" style="background:${color}"></span><span class="champ-name">${name}</span><span class="champ-pts">${pts}</span>`;
            this.body.appendChild(row);
        });
    }
}

class GForceMeter {
    constructor() {
        this.canvas = document.getElementById('g-force-canvas'); this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.visible = false; this.histX = []; this.histY = [];
    }
    toggle() { this.visible = !this.visible; if (this.canvas) this.canvas.style.display = this.visible ? 'block' : 'none'; }
    update(car) {
        if (!this.visible || !this.ctx || !car) return;
        const ctx = this.ctx, W = 80, H = 80, cx = W / 2, cy = H / 2, r = 36;
        ctx.clearRect(0, 0, W, H); ctx.fillStyle = 'rgba(6,8,14,0.95)'; ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.fill();
        [1, 2, 3, 4, 5].forEach(g => { ctx.strokeStyle = `rgba(26,32,48,${0.4 + g * 0.06})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r * (g / 5), 0, Math.PI * 2); ctx.stroke(); });
        ctx.strokeStyle = '#1a2535'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
        ctx.fillStyle = '#ccc'; ctx.font = '7px Share Tech Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText('5G', cx, cy - r + 8);

        let gX = (car.lateralG || 0) * curvSign_helper(car) * (r / 6); let gY = -(car.longitudinalG || 0) * (r / 6);
        this.histX.push(gX); this.histY.push(gY); if (this.histX.length > 30) { this.histX.shift(); this.histY.shift(); }
        this.histX.forEach((hx, i) => { let alpha = i / this.histX.length * 0.5; ctx.fillStyle = `rgba(0,210,190,${alpha})`; ctx.beginPath(); ctx.arc(cx + hx, cy + this.histY[i], 2, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = '#00d2be'; ctx.shadowColor = '#00d2be'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(cx + gX, cy + gY, 4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#888'; ctx.font = '7px Share Tech Mono, monospace'; ctx.fillText(`${Math.abs(car.lateralG || 0).toFixed(1)}G`, cx, cy + r - 3);
    }
}

class SectorWeatherSystem {
    constructor() { this.sectorRain = [0, 0, 0]; this.sectorRainTarget = [0, 0, 0]; this.timer = 0; this.icons = ['#sec-wx-0', '#sec-wx-1', '#sec-wx-2']; }
    update(mainRain, dt, gameEngine) {
        this.timer -= dt;
        if (this.timer <= 0) {
            this.timer = 300 + Math.random() * 600;
            if (mainRain > 0.1) {
                let sector = Math.floor(Math.random() * 3); this.sectorRainTarget[sector] = mainRain * (0.5 + Math.random() * 0.8);
                let other = Math.floor(Math.random() * 3); this.sectorRainTarget[other] = mainRain * Math.random() * 0.5;
            } else {
                for (let i = 0; i < 3; i++) { this.sectorRainTarget[i] = Math.max(0, this.sectorRainTarget[i] * (0.5 + Math.random() * 0.3)); }
            }
        }
        for (let i = 0; i < 3; i++) {
            this.sectorRain[i] += (this.sectorRainTarget[i] - this.sectorRain[i]) * 0.002 * dt;
            this.sectorRain[i] = Math.max(0, Math.min(1, this.sectorRain[i]));
            let el = document.querySelector(this.icons[i]);
            if (el) {
                if (this.sectorRain[i] > 0.5) el.textContent = '⛈️'; else if (this.sectorRain[i] > 0.15) el.textContent = '🌦️'; else if (this.sectorRain[i] > 0.01) el.textContent = '🌧️'; else el.textContent = '☀️';
                el.title = `S${i + 1}: ${(this.sectorRain[i] * 100).toFixed(0)}% wet`;
            }
        }
    }
    getGripForCar(car) {
        let sector = car.fraction < 0.35 ? 0 : car.fraction < 0.70 ? 1 : 2; return Math.max(0, 1.0 - this.sectorRain[sector] * 0.5);
    }
}