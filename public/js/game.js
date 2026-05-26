class GameManager {
  constructor() {
    this.track = new TrackGeometry();
    this.camera = new CameraDirector(document.getElementById("c"));
    this.audio = new AudioEngine();
    this.broadcast = new BroadcastDirector(this.audio);

    this.radio = new DriverRadio(this.audio);
    this.delta = new DeltaSystem();
    this.radioTimer = 0;
    this.trackLimitsFlashTimer = 0;

    this.stewards = new StewardSystem();
    this.telemetryGraph = new TelemetryGraph();
    this.championship = new ChampionshipSystem();
    this.gForceMeter = new GForceMeter();
    this.sectorWeather = new SectorWeatherSystem();
    this.porpoisingFlashTimer = 0;

    this.failureCascade = new FailureCascadeSystem();
    this.surfaceOverlay = document.getElementById("surface-overlay");
    this.emotionHud = document.getElementById("emotion-hud");
    this.emotionHudTimer = 0;
    this.cinematicShakeTimer = 0;
    this.cinematicZoomTarget = 1.0;
    this.cinematicZoom = 1.0;

    this.carsFinished = 0;
    this.winnerFinishTime = 0;

    try {
      const _snapRaw = localStorage.getItem("f1_race_snapshot");
      if (_snapRaw) {
        const _snap = JSON.parse(_snapRaw);
        if (
          _snap &&
          _snap.v === 2 &&
          _snap.driverOrder &&
          _snap.driverOrder.length === DRIVER_DB.length
        ) {
          const _nameMap = {};
          DRIVER_DB.forEach((d) => {
            _nameMap[d.n] = d;
          });
          const _ordered = _snap.driverOrder
            .map((n) => _nameMap[n])
            .filter(Boolean);
          if (_ordered.length === DRIVER_DB.length) {
            DRIVER_DB.length = 0;
            _ordered.forEach((d) => DRIVER_DB.push(d));
          } else {
            DRIVER_DB.sort(() => Math.random() - 0.5);
          }
        } else {
          DRIVER_DB.sort(() => Math.random() - 0.5);
        }
      } else {
        DRIVER_DB.sort(() => Math.random() - 0.5);
      }
    } catch (e) {
      DRIVER_DB.sort(() => Math.random() - 0.5);
    }

    {
      const tLen = 980;
      trackRubberMap = new Float32Array(tLen).fill(0);
      trackMarbleMap = new Float32Array(tLen).fill(0);
    }
    this.cars = Array.from({ length: NUM_CARS }, (_, i) => new CarModel(i));
    this.scCar = new SafetyCarModel();

    this.frames = 0;
    this.state = "QUALIFYING";
    this.raceTimerCount = 0;
    this.fastestLapOverall = Infinity;
    this.raceEndTriggered = false;
    this.flagState = "GREEN";
    this.flagTimer = 0;
    this.lastIncidentFrame = 600;

    this.weatherState = "CLEAR";
    this.targetRainIntensity = 0;
    this.rainIntensity = 0;
    this.trackWetness = 0;
    this.weatherTimer = Infinity;
    this.trackRubber = 0;
    this.hasDryBroadcast = true;

    this.particles = [];
    this.sprayParticles = [];
    this.skidMarks = [];
    this.speedGhosts = [];

    this.lastTime = performance.now();

    this.ctx = document.getElementById("c").getContext("2d", { alpha: false });
    window.addEventListener("resize", () => {
      document.getElementById("c").width = window.innerWidth;
      document.getElementById("c").height = window.innerHeight;
    });
    window.dispatchEvent(new Event("resize"));

    this.setupInteractivity();
    setTimeout(() => {
      this.updateUIBanner();
    }, 1000);

    const restored = this._restoreRaceSnapshot();
    if (!restored) requestAnimationFrame(() => this.step());
  }

  _saveRaceSnapshot() {
    try {
      const snap = {
        v: 2,
        state: this.state,
        driverOrder: DRIVER_DB.map((d) => d.n),
        frames: this.frames,
        raceTimerCount: this.raceTimerCount,
        trackWetness: this.trackWetness,
        rainIntensity: this.rainIntensity,
        flagState: this.flagState,
        carsFinished: this.carsFinished,
        trackRubber: this.trackRubber,
        _weatherProfile: this._weatherProfile,
        winnerFinishTime: this.winnerFinishTime,
        fastestLapOverall: this.fastestLapOverall,
        cars: this.cars.map((c) => ({
          id: c.id,
          name: c.name,
          dist: c.dist,
          speed: c.speed,
          uiPos: c.uiPos,
          laneOffset: c.laneOffset,
          tyreType: c.tyreType,
          tyreWear: c.tyreWear,
          tyreTemps: [...c.tyreTemps],
          pitStops: c.pitStops,
          fuelLoad: c.fuelLoad,
          retired: c.retired,
          finishedRace: c.finishedRace,
          finishPos: c.finishPos,
          finishTime: c.finishTime,
          ersBattery: c.ersBattery,
          ersMode: c.ersMode,
          hasWingDamage: c.hasWingDamage,
          hasPuncture: c.hasPuncture,
          dnfType: c.dnfType,
          timePenalty: c.timePenalty,
          strategyTargetLap: c.strategyTargetLap,
          lastPitLap: c.lastPitLap,
          inPitPhase: c.inPitPhase,
          wantsToPit: c.wantsToPit,
          pitTimer: c.pitTimer,
          pitBoxFrac: c.pitBoxFrac,
          paceMode: c.paceMode,
          drsActive: false,
          launchState: c.launchState === "WAIT" ? "NORMAL" : c.launchState,
          raceStarted: c.raceStarted,
          trackLimitsWarnings: c.trackLimitsWarnings,
          driveThrough: c.driveThrough,
          stopGoPenalty: c.stopGoPenalty,
          isSpinning: false,
          spinTimer: 0,
          graining: c.graining,
          blistering: c.blistering,
          flatSpots: [...c.flatSpots],
          championship: c.championship,
        })),
      };
      localStorage.setItem("f1_race_snapshot", JSON.stringify(snap));
    } catch (e) { }
  }

  _clearRaceSnapshot() {
    try {
      localStorage.removeItem("f1_race_snapshot");
      localStorage.removeItem("f1_has_bet");
    } catch (e) { }
  }

  _restoreRaceSnapshot() {
    try {
      const raw = localStorage.getItem("f1_race_snapshot");
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (!snap || snap.v !== 2) {
        this._clearRaceSnapshot();
        return false;
      }
      const validStates = ["GREEN", "SC", "VSC", "FORMATION", "GRID_WAIT"];
      if (!validStates.includes(snap.state)) {
        this._clearRaceSnapshot();
        return false;
      }

      this.state = snap.state;
      this.frames = snap.frames;
      this.raceTimerCount = snap.raceTimerCount;
      this.trackWetness = snap.trackWetness;
      this.rainIntensity = snap.rainIntensity;
      this.flagState = snap.flagState || "GREEN";
      this.carsFinished = snap.carsFinished || 0;
      this.trackRubber = snap.trackRubber || 0.5;
      this._weatherProfile = snap._weatherProfile || "DRY";
      this.winnerFinishTime = snap.winnerFinishTime || 0;
      this.fastestLapOverall = snap.fastestLapOverall || Infinity;

      const sqModal = document.getElementById("skip-qual-modal");
      if (sqModal) sqModal.classList.add("hidden");

      const ttMdr = document.getElementById("race-title");
      if (ttMdr) {
        ttMdr.textContent = _activeTrack.name + " · V11.5 RACE DIRECTOR";
        ttMdr.style.color = "#fff";
      }
      const thHdr = document.getElementById("lb-gap-hdr");
      if (thHdr) thHdr.textContent = "GAP";

      const snapMap = {};
      snap.cars.forEach((sc) => {
        snapMap[sc.id] = sc;
      });

      this.cars.forEach((car) => {
        const sc = snapMap[car.id];
        if (!sc) return;
        car.dist = sc.dist;
        car.speed = sc.speed;
        car.uiPos = sc.uiPos;
        car.laneOffset = sc.laneOffset;
        car.targetLane = sc.laneOffset;
        car.tyreType = sc.tyreType;
        car.tyreWear = sc.tyreWear;
        if (sc.tyreTemps) car.tyreTemps = sc.tyreTemps;
        car.pitStops = sc.pitStops;
        car.fuelLoad = sc.fuelLoad;
        car.retired = sc.retired;
        car.finishedRace = sc.finishedRace;
        car.finishPos = sc.finishPos;
        car.finishTime = sc.finishTime;
        car.ersBattery = sc.ersBattery;
        car.ersMode = sc.ersMode || "HARV";
        car.hasWingDamage = sc.hasWingDamage;
        car.hasPuncture = sc.hasPuncture;
        car.dnfType = sc.dnfType || "";
        car.timePenalty = sc.timePenalty || 0;
        car.strategyTargetLap = sc.strategyTargetLap;
        car.lastPitLap = sc.lastPitLap;
        car.inPitPhase = sc.inPitPhase;
        car.wantsToPit = sc.wantsToPit;
        if (sc.pitBoxFrac !== undefined) car.pitBoxFrac = sc.pitBoxFrac;
        car.paceMode = sc.paceMode || "STANDARD";
        car.launchState = sc.launchState || "NORMAL";
        car.raceStarted = sc.raceStarted;
        car.trackLimitsWarnings = sc.trackLimitsWarnings || 0;
        car.driveThrough = sc.driveThrough || false;
        car.stopGoPenalty = sc.stopGoPenalty || false;
        car.graining = sc.graining || 0;
        car.blistering = sc.blistering || 0;
        if (sc.flatSpots) car.flatSpots = sc.flatSpots;
        car.championship = sc.championship || 0;
        car.qPhase = "RACING";
        car.isSpinning = false;
        car.spinTimer = 0;
        car.drsActive = false;
        car.collisionShake = 0;
        car.bumpShake = 0;
        car.reactionTimer = 0;
      });

      this.addFIAMessage(
        "⚡ RACE RESUMED FROM CHECKPOINT — RECONNECTING TO LIVE TIMING",
      );
      setTimeout(() => {
        this.updateUIBanner();
      }, 500);

      if (this.state === "FORMATION" || this.state === "GRID_WAIT") {
        this.state = "GREEN";
        this.flagState = "GREEN";
      }

      requestAnimationFrame(() => this.step());
      return true;
    } catch (e) {
      this._clearRaceSnapshot();
      return false;
    }
  }

  setupInteractivity() {
    const sqModal = document.getElementById("skip-qual-modal");
    const sqAllow = document.getElementById("sq-allow");
    const sqDeny = document.getElementById("sq-deny");

    const dismissModal = () => {
      if (sqModal) sqModal.classList.add("hidden");
    };

    if (sqAllow)
      sqAllow.onclick = () => {
        dismissModal();
        this.cars.sort(() => Math.random() - 0.5);
        this.cars.forEach((c, i) => {
          c.bestLap = 80 + i * 0.4 + Math.random() * 0.3;
        });
        this.addFIAMessage(
          "QUALIFYING SKIPPED — RANDOM GRID ORDER APPLIED",
          "strat-text",
        );
        this.transitionToRace();
      };

    if (sqDeny)
      sqDeny.onclick = () => {
        dismissModal();
        this.broadcast.triggerEvent({ type: "q_start" });
        this.camera.forceEventCut(0, 1, "start", 300);
      };
    const lbBody = document.getElementById("lb-body");
    if (!lbBody) return;
    this.cars.forEach((c, k) => {
      let r = document.createElement("div");
      r.id = `lb-row-${k}`;
      r.onclick = () => {
        document
          .querySelectorAll(".cam-btn")
          .forEach((bn) => bn.classList.remove("active"));
        let tvb = document.getElementById("cam-tv");
        if (tvb) tvb.classList.add("active");
        this.camera.setTarget(c.id);
        this.camera.setMode("tv");
      };
      r.innerHTML = `<div class="lb-pos" id="lb-pos-${k}"></div><div class="lb-dot" id="lb-dot-${k}"></div><div class="lb-name" id="lb-name-${k}"></div><div class="lb-gap" id="lb-gap-${k}"></div><div class="lb-tyre" id="lb-tyre-${k}"></div><div id="lb-wear-${k}" style="font-size:10px;text-align:right"></div><div id="lb-ers-${k}" style="font-size:10px;text-align:right;font-weight:bold"></div><div id="lb-spd-${k}" style="font-size:10px;text-align:right"></div><div id="lb-pit-${k}" style="font-size:10px;text-align:center"></div>`;
      lbBody.appendChild(r);
    });

    let vTog = document.getElementById("voice-toggle");
    if (vTog) vTog.onclick = () => this.audio.toggleVoice();
    let champBtn = document.getElementById("champ-toggle-btn");
    if (champBtn) champBtn.onclick = () => this.championship.toggle();
    let telBtn = document.getElementById("telgraph-toggle-btn");
    if (telBtn) telBtn.onclick = () => this.telemetryGraph.toggle();

    ["auto", "tv", "chase", "onboard", "heli"].forEach((m) => {
      let b = document.getElementById(`cam-${m}`);
      if (b)
        b.onclick = (e) => {
          document
            .querySelectorAll(".cam-btn")
            .forEach((bn) => bn.classList.remove("active"));
          e.target.classList.add("active");
          if (m === "auto") {
            this.camera.setMode("auto");
          } else {
            this.camera.setMode(m);
          }
        };
    });
  }

  transitionToRace() {
    this._clearRaceSnapshot();
    this.state = "GRID_PREP";
    this.broadcast.triggerEvent({ type: "q_end" });
    this.addFIAMessage("QUALIFYING COMPLETE - FORMATION SEQUENCE IMMINENT");

    setTimeout(() => {
      let thHdr = document.getElementById("lb-gap-hdr");
      if (thHdr) thHdr.textContent = "GAP";
      let ttMdr = document.getElementById("race-title");
      if (ttMdr) {
        ttMdr.textContent = _activeTrack.name + " · V11.5 RACE DIRECTOR";
        ttMdr.style.color = "#fff";
      }
      let dHdr = document.getElementById("lap-display");
      if (dHdr) dHdr.textContent = `FORMATION`;

      const _wr = Math.random();
      if (_wr < 0.38) {
        this._weatherProfile = "DRY";
        this.weatherTimer = Infinity;
      } else if (_wr < 0.72) {
        this._weatherProfile = "SHOWER";
        this.weatherTimer = this.frames + 3500 + Math.random() * 6000;
      } else {
        this._weatherProfile = "WET";
        this.weatherTimer = this.frames + 400 + Math.random() * 2500;
      }
      this._rainSpellsLeft =
        this._weatherProfile === "WET" ? 2 + Math.floor(Math.random() * 3) : 1;

      this.trackRubber = 0.5;
      this.hasDryBroadcast = false;
      this.fastestLapOverall = Infinity;
      this.raceTimerCount = 0;
      this.carsFinished = 0;
      this.winnerFinishTime = 0;

      this.cars.sort((a, b) => (a.bestLap || 999999) - (b.bestLap || 999999));

      this.cars.forEach((c, idx) => {
        c.gridSlotIdx = idx;
        c.gridTargetDist = 0.99 - idx * 0.015;
        c.dist = c.gridTargetDist - 0.99;
        c.laneOffset = idx % 2 === 0 ? -0.4 : 0.4;
        c.speed = 0;
        c.displayKmh = 0;
        c.gear = 1;
        c.rpm = 4000;
        c.brakeActive = false;
        c.throttlePercent = 0;
        c.brakeGlow = 0;
        c.x = 0;
        c.y = 0;
        c.tangAngle = 0;

        c.targetVelocitySmoothed = MAX_BASE_SPEED * 0.3;
        c.laneVelocity = 0;
        c.steerAngle = 0;
        c.bodyPitch = 0;
        c.bodyRoll = 0;
        c.lapStartTime = 0;
        c.currentSector = 0;
        c.sectorTimes = [0, 0, 0];
        c.bestLap = Infinity;
        c.inPitPhase = 0;
        c.retired = false;
        c.isSpinning = false;
        c.spinTimer = 0;
        c.hasWingDamage = false;
        c.hasPuncture = false;
        c.drsActive = false;
        c.ersBattery = 100.0;
        c.tyreWear = 0;
        c.pitStops = 0;
        c.tyreTemps = [70, 70, 70, 70];
        c.paceMode = "STANDARD";
        c.wantsToPit = false;
        c.targetPitTyre = null;
        c.timePenalty = 0;
        c.pitSpeedPenaltyIssued = false;
        c.pitLinePenaltyIssued = false;
        if (c.overtakeState) {
          c.overtakeState.committed = false;
          c.overtakeState.targetLane = 0;
          c.overtakeState.timer = 0;
          c.overtakeState.fallback = false;
        }

        let strategyRand = Math.random();
        if (this.trackWetness >= 0.65) {
          c.tyreType = "WET";
        } else if (this.trackWetness >= 0.15) {
          c.tyreType = "INTER";
        } else {
          if (idx < 6) {
            c.tyreType = strategyRand < 0.6 ? "MEDIUM" : "SOFT";
          } else if (idx < 14) {
            c.tyreType =
              strategyRand < 0.4
                ? "MEDIUM"
                : strategyRand < 0.7
                  ? "SOFT"
                  : "HARD";
          } else {
            c.tyreType =
              strategyRand < 0.5
                ? "HARD"
                : strategyRand < 0.8
                  ? "MEDIUM"
                  : "SOFT";
          }
        }

        let tDur = (TYRES[c.tyreType] || TYRES["SOFT"]).dur;
        c.strategyTargetLap = tDur + Math.floor(Math.random() * 4 - 1);
        c.launchState = "WAIT";
        c.reactionTimer = 0;
        c.lastPitLap = -1;
        c.qPhase = "RACING";
        c.fuelLoad = 110.0;
        c.trackLimitsWarnings = 0;
        c.lapDeleted = false;
        c.isLiftCoasting = false;
        c.slipAngle = 0;
        c.smoothedSlipAngle = 0;
        c.yawRate = 0;
        c.lateralG = 0;
        c.longitudinalG = 0;
        c.wheelspin = 0;
        c.lockupAmount = 0;
        c.graining = 0;
        c.blistering = 0;
        c.flatSpots = [0, 0, 0, 0];
        c.tyrePressure = [23.5, 23.5, 21.5, 21.5];
        c.downforce = 0;
        c.isPorpoising = false;
        c.wingDamageLevel = 0;
        c.hasBrokenWing = false;
        c.driveThrough = false;
        c.collisionShake = 0;
        c.bumpShake = 0;
        c.fakeMove = false;
        c.switchback = false;
        c.telHistory = { thr: [], brk: [], rpm: [], spd: [] };
        c.emotion = "neutral";
        c.emotionTimer = 0;
        c.turboSpool = 0;
        c.engineBrakeForce = 0;
        c.cascadeType = null;
        c.surfaceType = "tarmac";
        c.trackEvolutionGrip = 1.0;
        c.pacejkaGrip = 1.0;
        c.finishedRace = false;
        c.finishPos = 0;
        c.finishTime = 0;
      });

      this.state = "FORMATION";
      this.setFlag("GREEN", 0);
      this.addFIAMessage("FORMATION LAP UNDERWAY");
      this.broadcast.triggerEvent({ type: "formation" });
    }, 7000);
  }

  startSequence() {
    this.addFIAMessage("GRID SET. WAITING FOR LIGHTS.", "strat-text");
    let b = 0;
    let tmr = setInterval(
      () => {
        if (b < 5) {
          let lt = document.getElementById("l" + b);
          if (lt) lt.classList.add("red");
          let ctn = document.getElementById("lights-container");
          if (ctn) ctn.style.opacity = 1;
        } else {
          clearInterval(tmr);
          document
            .querySelectorAll(".t-light")
            .forEach((d) => d.classList.remove("red"));
          let ctn = document.getElementById("lights-container");
          if (ctn) ctn.style.display = "none";

          this.cars.forEach((c) => {
            if (c.launchState === "JUMPED") return;
            c.reactionTimer = 5 + Math.random() * (1.0 - c.skill) * 45;
            let rLaunch = Math.random();
            if (rLaunch < 0.08) c.launchState = "BOGGED";
            else if (rLaunch > 0.85 && Math.random() < c.skill) {
              c.launchState = "PERFECT";
            } else c.launchState = "NORMAL";
          });

          this.state = "GREEN";
          this.broadcast.triggerEvent({ type: "start" });
          this.camera.forceEventCut(this.cars[0].id, 10, "start", 450);
          let bog = this.cars.find((c) => c.launchState === "BOGGED");
          if (bog && bog.uiPos < 10)
            setTimeout(() => {
              this.broadcast.triggerEvent({ type: "stall", car: bog });
            }, 2000);
        }
        b++;
      },
      800 + Math.random() * 400,
    );
  }

  addFIAMessage(msgText, cls = "") {
    const fbox = document.getElementById("fia-feed");
    if (!fbox) return;
    if (
      fbox.innerText.includes("Optimal") ||
      fbox.innerText.includes("SHOOTOUT") ||
      fbox.innerText.includes("nominal")
    )
      fbox.innerHTML = "";
    const msg = document.createElement("div");
    msg.className = "fia-msg " + cls;
    let p = "[RACE CONTROL]";
    if (this.state === "QUALIFYING") p = "[Q1]";
    else if (this.state === "GREEN" && this.cars[0])
      p = `[LAP ${Math.min(TOTAL_LAPS, this.cars[0].currentLap)}]`;
    msg.innerText = `${p} ${msgText}`;
    fbox.prepend(msg);
    while (fbox.children.length > 5) fbox.removeChild(fbox.lastChild);
  }

  setFlag(type, framesDuration) {
    if (this.flagState === "SC" && type === "YELLOW") return;
    if (this.flagState === "SC" && type === "VSC") return;
    this.flagState = type;
    this.flagTimer = framesDuration;
    if (type === "GREEN") {
      this.scCar.active = false;
      this.scCar.dist = 0;
      this.scCar.speed = 0;
    }
    this.updateUIBanner();
  }

  updateUIBanner() {
    const b = document.getElementById("flag-box"),
      t = document.getElementById("flag-text"),
      m = document.getElementById("topbar");
    if (!b || !t || !m) return;
    b.classList.remove("flashing");
    t.classList.remove("flashing");
    m.className = "";
    if (this.state === "QUALIFYING") {
      m.className = "q-mode";
      b.style.background = "#e0009c";
      b.style.color = "#fff";
      b.innerText = "⏱️";
      t.innerText = "QUALIFYING";
      t.style.color = "var(--pink)";
    } else if (this.state === "FORMATION" || this.state === "GRID_WAIT") {
      b.style.background = "var(--yellow)";
      b.innerText = "🟡";
      t.innerText = "FORMATION LAP";
      t.style.color = "var(--yellow)";
    } else {
      if (this.flagState === "GREEN") {
        b.style.background = "#00d2be";
        b.style.color = "#000";
        b.innerText = "🟢";
        t.innerText = "GREEN FLAG";
        t.style.color = "var(--green)";
      }
      if (this.flagState === "YELLOW") {
        b.style.background = "var(--yellow)";
        b.innerText = "🟡";
        t.innerText = "LOCAL YELLOW";
        t.style.color = "var(--yellow)";
      }
      if (this.flagState === "VSC") {
        b.style.background = "var(--yellow)";
        b.innerText = "VSC";
        b.classList.add("flashing");
        t.classList.add("flashing");
        t.innerText = "VIRTUAL SC";
        t.style.color = "var(--yellow)";
        m.className = "vsc-mode";
      }
      if (this.flagState === "SC") {
        b.style.background = "var(--orange)";
        b.innerText = "SC";
        b.classList.add("flashing");
        t.classList.add("flashing");
        t.innerText = "SAFETY CAR";
        t.style.color = "var(--orange)";
        m.className = "sc-mode";
      }
    }
  }

  spawnParticles(x, y, vxBase, vyBase, clr, c, dt) {
    for (let i = 0; i < c; i++) {
      this.particles.push({
        x: x,
        y: y,
        vx: vxBase + (Math.random() - 0.5) * 5,
        vy: vyBase + (Math.random() - 0.5) * 5,
        life: 1.0,
        clr: clr,
        maxLife: 30 + Math.random() * 20,
      });
    }
  }

  spawnSpray(c, wet, dt) {
    const amt = Math.floor(wet * 4) + 1;
    const speedRatio = c.displayKmh / 300;
    const ox = c.x - Math.cos(c.tangAngle) * (CAR_LENGTH * 0.4);
    const oy = c.y - Math.sin(c.tangAngle) * (CAR_LENGTH * 0.4);
    for (let i = 0; i < amt; i++) {
      const spread = (Math.random() - 0.5) * 0.4;
      this.sprayParticles.push({
        x: ox,
        y: oy,
        vx:
          -Math.cos(c.tangAngle + spread) * (speedRatio * 8) +
          (Math.random() - 0.5) * 2,
        vy:
          -Math.sin(c.tangAngle + spread) * (speedRatio * 8) +
          (Math.random() - 0.5) * 2,
        life: 1.0,
        maxLife: 20 + Math.random() * 20,
        size: 2 + Math.random() * 3 + wet * 4,
      });
    }
  }

  handleWeatherEngine(dt) {
    if (
      this.state === "GRID" ||
      this.state === "QUALIFYING" ||
      this.state === "FORMATION" ||
      this.state === "GRID_WAIT"
    )
      return;

    if (this.frames > this.weatherTimer) {
      const profile = this._weatherProfile || "DRY";
      const r = Math.random();

      if (this.weatherState === "CLEAR") {
        if ((this._rainSpellsLeft || 0) > 0) {
          if (profile === "WET" && r < 0.65) {
            if (r < 0.3) {
              this.weatherState = "HEAVY RAIN";
              this.targetRainIntensity = 0.75 + Math.random() * 0.25;
              this.addFIAMessage(
                "WEATHER: HEAVY RAIN APPROACHING",
                "rain-text",
              );
            } else {
              this.weatherState = "LIGHT RAIN";
              this.targetRainIntensity = 0.3 + Math.random() * 0.25;
              this.addFIAMessage("WEATHER: LIGHT RAIN INBOUND", "rain-text");
            }
            this._rainSpellsLeft--;
            this.weatherTimer = this.frames + 1200 + Math.random() * 2800;
          } else if (profile === "SHOWER" && r < 0.7) {
            this.weatherState = r < 0.18 ? "HEAVY RAIN" : "LIGHT RAIN";
            this.targetRainIntensity =
              this.weatherState === "HEAVY RAIN"
                ? 0.65 + Math.random() * 0.25
                : 0.25 + Math.random() * 0.2;
            this.addFIAMessage(
              this.weatherState === "HEAVY RAIN"
                ? "WEATHER: HEAVY RAIN APPROACHING"
                : "WEATHER: LIGHT SHOWER DEVELOPING",
              "rain-text",
            );
            this._rainSpellsLeft--;
            this.weatherTimer = this.frames + 800 + Math.random() * 1800;
          } else {
            this.weatherTimer = this.frames + 2000 + Math.random() * 4000;
          }
        } else {
          this.weatherTimer = Infinity;
        }
      } else {
        if (r < 0.42) {
          this.weatherState = "CLEAR";
          this.targetRainIntensity = 0;
          this.addFIAMessage(
            "WEATHER: RAIN HAS STOPPED. TRACK DRYING",
            "rain-text",
          );
          const dryGap =
            profile === "WET"
              ? 1500 + Math.random() * 3000
              : 4000 + Math.random() * 8000;
          this.weatherTimer =
            (this._rainSpellsLeft || 0) > 0 ? this.frames + dryGap : Infinity;
        } else if (this.weatherState === "LIGHT RAIN" && r < 0.75) {
          this.weatherState = "HEAVY RAIN";
          this.targetRainIntensity = 0.8 + Math.random() * 0.2;
          this.addFIAMessage("WEATHER: RAIN INTENSIFYING", "rain-text");
          this.weatherTimer = this.frames + 1000 + Math.random() * 2000;
        } else if (this.weatherState === "HEAVY RAIN" && r < 0.55) {
          this.weatherState = "LIGHT RAIN";
          this.targetRainIntensity = 0.25 + Math.random() * 0.2;
          this.addFIAMessage("WEATHER: RAIN EASING SLIGHTLY", "rain-text");
          this.weatherTimer = this.frames + 800 + Math.random() * 1500;
        } else {
          this.weatherTimer = this.frames + 600 + Math.random() * 1200;
        }
      }
      this.broadcast.triggerEvent({
        type: "weather",
        weather: this.weatherState,
      });
    }

    this.rainIntensity +=
      (this.targetRainIntensity - this.rainIntensity) * 0.001 * dt;
    if (this.trackWetness < this.rainIntensity)
      this.trackWetness += 0.0006 * dt;
    else this.trackWetness -= 0.0002 * dt;
    this.trackWetness = Math.max(0, Math.min(1, this.trackWetness));

    if (this.state === "GREEN" && this.trackWetness < 0.05) {
      this.trackRubber = Math.min(1.0, this.trackRubber + 0.00018 * dt);
      if (this.trackRubber > 0.8 && !this.hasDryBroadcast) {
        this.hasDryBroadcast = true;
        this.broadcast.triggerEvent({ type: "dry" });
      }
    } else if (this.trackWetness > 0) {
      this.trackRubber = Math.max(
        0.0,
        this.trackRubber - this.trackWetness * 0.005 * dt,
      );
      this.hasDryBroadcast = false;
    }

    if (trackRubberMap && this.state === "GREEN" && this.trackWetness < 0.1) {
      this.cars.forEach((c) => {
        if (c.retired || c.inPitPhase > 0) return;
        const tLen = trackRubberMap.length;
        const idx = Math.floor(c.fraction * tLen) % tLen;
        trackRubberMap[idx] = Math.min(1.0, trackRubberMap[idx] + 0.00002 * dt);
        const marbleIdx = (idx + Math.floor(tLen * 0.003)) % tLen;
        trackMarbleMap[marbleIdx] = Math.min(
          1.0,
          trackMarbleMap[marbleIdx] + 0.000008 * dt,
        );
      });
    }

    const wbar = document.getElementById("w-bar");
    if (wbar) wbar.style.width = this.trackWetness * 100 + "%";
    let wetText = Math.floor(this.trackWetness * 100) + "%";
    let ico = "☀️";
    if (this.rainIntensity > 0.6) ico = "⛈️";
    else if (this.rainIntensity > 0.1) ico = "🌦️";
    else if (this.trackWetness > 0.2) ico = "☁️";
    const wicon = document.getElementById("w-icon"),
      wtxt = document.getElementById("w-text");
    if (wicon) wicon.innerText = ico;
    if (wtxt) wtxt.innerText = wetText;
  }

  handleIncidentsEngine(dt) {
    if (this.state !== "GREEN" && this.state !== "FINISHED") return;

    if (this.flagTimer > 0) {
      this.flagTimer -= dt;
      if (this.flagState === "SC" && Math.floor(this.flagTimer) === 300) {
        this.addFIAMessage("SAFETY CAR IN THIS LAP", "sc-text");
        this.broadcast.triggerEvent({ type: "sc_in" });
        this.cars.forEach((c) => {
          if (c.overtakeState) {
            c.overtakeState.committed = false;
            c.overtakeState.timer = 0;
          }
        });
      }
      if (this.flagTimer <= 0 && this.flagState !== "GREEN") {
        if (this.flagState === "VSC")
          this.broadcast.triggerEvent({ type: "vsc_in" });
        this.flagState = "GREEN";
        this.scCar.active = false;
        this.scCar.dist = 0;
        this.scCar.speed = 0;
        this.flagTimer = 0;
        this.addFIAMessage("TRACK CLEAR - GREEN FLAG");
        this.updateUIBanner();
      }
    }

    if (this.frames - this.lastIncidentFrame < 800) return;

    this.cars.forEach((c) => {
      if (c.retired || c.inPitPhase > 0 || c.finishedRace) return;

      let baseRisk = 0.00002 * dt;
      let wrongTyrePen = 0;
      if (
        this.trackWetness > 0.25 &&
        (c.tyreType === "SOFT" ||
          c.tyreType === "MEDIUM" ||
          c.tyreType === "HARD")
      )
        wrongTyrePen = 0.0008 * dt;

      let avgT =
        (c.tyreTemps[0] + c.tyreTemps[1] + c.tyreTemps[2] + c.tyreTemps[3]) / 4;
      const typeCfg = TYRES[c.tyreType] || TYRES["SOFT"];
      let tRisk = Math.abs(avgT - typeCfg.optTemp) > 20 ? 0.0002 * dt : 0;
      const gripConf = c.gripConfidence !== undefined ? c.gripConfidence : 0.7;
      const emMod = emotionToModifiers(c.emotion || "neutral", gripConf);
      const emotionRisk =
        emMod.brakeMod < 1.0 ? (1 - emMod.brakeMod) * 0.0006 * dt : 0;
      const gripRisk = Math.max(0, 0.7 - gripConf) * 0.0005 * dt;

      let risk =
        baseRisk +
        wrongTyrePen +
        tRisk +
        Math.pow(c.tyreWear / 100, 2) * 0.0004 * dt +
        (1.0 - c.skill) * 0.0001 * dt +
        emotionRisk +
        gripRisk;

      if (Math.random() < risk && this.frames - this.lastIncidentFrame > 800) {
        let r = Math.random();
        if (r < 0.4) {
          c.shiftTimer += 20;
          c.tyreWear += 6;
          this.camera.forceEventCut(c.id, 6, "lockup", 300);
          this.spawnParticles(c.x, c.y, 0, 0, "#ddd", 40, dt);
          this.broadcast.triggerEvent({ type: "lockup", car: c });
          this.addFIAMessage(`LOCKUP - ${c.name}`);
          this.lastIncidentFrame = this.frames;
        } else if (r < 0.47) {
          let victim = this.cars.find(
            (x) =>
              x !== c &&
              !x.retired &&
              !x.inPitPhase &&
              !x.finishedRace &&
              Math.abs(x.dist - c.dist) < 0.03,
          );
          if (victim) {
            c.collisionShake = 8;
            victim.collisionShake = 6;
            this.stewards.investigate("collision", c, victim, this);
            this.spawnParticles(c.x, c.y, 0, 0, c.color, 25, dt);
            this.spawnParticles(c.x, c.y, 0, 0, "#ccc", 15, dt);
            this.camera.forceEventCut(c.id, 9, "crash", 400);
            this.broadcast.triggerEvent({
              type: "collision",
              carA: c,
              carB: victim,
            });
            this.addFIAMessage(
              `COLLISION - ${c.name} / ${victim.name} - UNDER INVESTIGATION`,
              "sc-text",
            );
            this.setFlag("YELLOW", 250);
            this.lastIncidentFrame = this.frames;
          }
        } else if (r < 0.65) {
          if (this.trackWetness > 0.1 || c.tyreWear > 70 || tRisk > 0) {
            c.isSpinning = true;
            c.spinTimer = 180;
            this.setFlag("YELLOW", 200);
            this.camera.forceEventCut(c.id, 9, "spin", 400);
            this.spawnParticles(c.x, c.y, 0, 0, "#aaa", 50, dt);
            this.broadcast.triggerEvent({ type: "spin", car: c });
            this.addFIAMessage(
              `SPIN - ${c.name} - SECTOR ${c.currentSector + 1}`,
              "sc-text",
            );
            this.lastIncidentFrame = this.frames;
          } else {
            c.shiftTimer += 25;
            c.tyreWear += 8;
            this.camera.forceEventCut(c.id, 6, "lockup", 300);
            this.spawnParticles(c.x, c.y, 0, 0, "#ddd", 60, dt);
            this.broadcast.triggerEvent({ type: "lockup", car: c });
            this.addFIAMessage(`MAJOR LOCKUP - ${c.name}`);
            this.lastIncidentFrame = this.frames;
          }
        } else if (r < 0.82) {
          c.hasWingDamage = true;
          this.setFlag("VSC", 700);
          this.camera.forceEventCut(c.id, 9, "crash", 400);
          this.broadcast.triggerEvent({ type: "wing", car: c });
          this.addFIAMessage(`DEBRIS - VSC DEPLOYED - ${c.name}`, "sc-text");
          this.lastIncidentFrame = this.frames;
        } else if (r < 0.94 && c.tyreWear > 40) {
          c.hasPuncture = true;
          this.setFlag("YELLOW", 500);
          this.camera.forceEventCut(c.id, 9, "crash", 400);
          this.spawnParticles(c.x, c.y, 0, 0, "#666", 80, dt);
          this.broadcast.triggerEvent({ type: "puncture", car: c });
          this.addFIAMessage(`PUNCTURE - ${c.name}`);
          this.lastIncidentFrame = this.frames;
        } else if (r > 0.94) {
          let cascType =
            Math.random() < 0.4
              ? "thermal"
              : Math.random() < 0.5
                ? "gearbox"
                : "hydraulic";
          this.failureCascade.initCascade(c, cascType);
          this.camera.forceEventCut(c.id, 9, "engine", 450);
          this.broadcast.triggerEvent({ type: "engine", car: c });
          this.addFIAMessage(
            `${c.name} - ${cascType.toUpperCase()} ISSUE DEVELOPING`,
            "sc-text",
          );
          this.lastIncidentFrame = this.frames;
        }
      }
    });
  }

  resolveCollisions(dtSub) {
    for (let i = 0; i < this.cars.length; i++) {
      const carA = this.cars[i];
      if (carA.inPitPhase > 0 || carA.retired) continue;

      for (let j = i + 1; j < this.cars.length; j++) {
        const carB = this.cars[j];
        if (carB.inPitPhase > 0 || carB.retired) continue;

        const dx = carB.x - carA.x;
        const dy = carB.y - carA.y;
        const dist = Math.hypot(dx, dy);
        const minPhysicalSeparation = 5.2;

        if (dist < minPhysicalSeparation && dist > 0.01) {
          const overlapAmount = minPhysicalSeparation - dist;
          const pushX = (dx / dist) * overlapAmount * 0.5;
          const pushY = (dy / dist) * overlapAmount * 0.5;

          carA.x -= pushX;
          carA.y -= pushY;
          carB.x += pushX;
          carB.y += pushY;
          carA.speed *= Math.pow(0.96, dtSub);
          carB.speed *= Math.pow(0.96, dtSub);

          const infoA = this.track.getPointAt(carA.fraction);
          if (infoA) {
            const cartesianCrossShift =
              (carA.x - infoA.x) * infoA.nx + (carA.y - infoA.y) * infoA.ny;
            carA.laneOffset = cartesianCrossShift / (TRACK_WIDTH_PX / 2.2);
          }
          const infoB = this.track.getPointAt(carB.fraction);
          if (infoB) {
            const cartesianCrossShift =
              (carB.x - infoB.x) * infoB.nx + (carB.y - infoB.y) * infoB.ny;
            carB.laneOffset = cartesianCrossShift / (TRACK_WIDTH_PX / 2.2);
          }
        }
      }
    }
  }

  step() {
    if (this.state === "GRID_PREP") {
      requestAnimationFrame(() => this.step());
      return;
    }

    const now = performance.now();
    let dt = (now - this.lastTime) / 16.666;
    if (dt > 8) dt = 1.0;
    else if (dt > 3) dt = 1.5;
    this.lastTime = now;

    this.frames += dt;
    if (this.state !== "GRID_WAIT") this.raceTimerCount += (1 / 60) * dt;

    if (
      (this.state === "GREEN" || this.state === "SC" || this.state === "VSC") &&
      Math.floor(this.frames) % 300 === 0
    ) {
      this._saveRaceSnapshot();
    }

    this.handleWeatherEngine(dt);
    this.handleIncidentsEngine(dt);
    this.sectorWeather.update(this.rainIntensity, dt, this);
    this.stewards.updateDriveThroughs(this.cars, this.state, this);

    if (this.porpoisingFlashTimer > 0) {
      this.porpoisingFlashTimer -= dt;
      const pw = document.getElementById("porpoising-warn");
      if (pw) pw.classList.toggle("show", this.porpoisingFlashTimer > 0);
    }

    if (Math.floor(this.frames) % 30 === 0 && this.state === "GREEN") {
      const avgSpeed =
        this.cars.reduce((s, c) => s + c.speed, 0) / this.cars.length;
      this.cars.forEach((c) =>
        updateAIEmotion(c, { avgSpeed, trackWetness: this.trackWetness }),
      );
      if (this.emotionHud) {
        const focused = this.cars.find(
          (c) => c.id === this.camera?.focusTargetId,
        );
        if (focused && focused.emotion !== "neutral") {
          const labels = {
            panic: "😱 PANIC",
            frustration: "😤 FRUSTRATED",
            confidence: "😎 CONFIDENT",
            aggro: "😠 AGGRESSIVE",
          };
          this.emotionHud.innerHTML = `<div class="emotion-badge ${focused.emotion}">${labels[focused.emotion] || focused.emotion.toUpperCase()} · ${focused.name}</div>`;
          this.emotionHudTimer = 180;
        }
      }
    }
    if (this.emotionHudTimer > 0) {
      this.emotionHudTimer -= dt;
      if (this.emotionHudTimer <= 0 && this.emotionHud)
        this.emotionHud.innerHTML = "";
    }

    this.failureCascade.update(dt, this);

    {
      const focused = this.cars.find(
        (c) => c.id === this.camera?.focusTargetId,
      );
      const surf = this.surfaceOverlay;
      if (surf && focused && focused.surfaceType !== "tarmac") {
        surf.textContent =
          focused.surfaceType === "grass"
            ? "🌿 GRASS — REDUCED GRIP"
            : "⚠ GRAVEL TRAP";
        surf.className = "show " + focused.surfaceType;
      } else if (surf) {
        surf.className = "";
      }
    }

    {
      const focused = this.cars.find(
        (c) => c.id === this.camera?.focusTargetId,
      );
      if (focused) {
        const focusedShake = Math.max(
          focused.collisionShake || 0,
          focused.bumpShake || 0,
        );
        if (focusedShake > 4 && this.camera) {
          this.camera.shakeX += (Math.random() - 0.5) * focusedShake * 0.3;
          this.camera.shakeY += (Math.random() - 0.5) * focusedShake * 0.3;
        }
        let nearby = this.cars.filter(
          (o) =>
            o !== focused &&
            !o.retired &&
            Math.abs((o.dist - focused.dist) % 1.0) < 0.04,
        );
        this.cinematicZoomTarget = nearby.length >= 1 ? 0.72 : 0.55;
        this.cinematicZoom +=
          (this.cinematicZoomTarget - this.cinematicZoom) * 0.008 * dt;
      }
    }

    this.radioTimer -= dt;
    if (this.radioTimer <= 0 && this.state === "GREEN") {
      this.radioTimer = 400 + Math.random() * 600;
      const rc = this.cars[Math.floor(Math.random() * this.cars.length)];
      if (!rc.retired && rc.inPitPhase === 0 && !rc.finishedRace) {
        const r = Math.random();
        if (r < 0.25 && rc.fuelLoad < 30) this.radio.trigger("fuel", rc);
        else if (r < 0.45 && rc.tyreWear > 60) this.radio.trigger("tyres", rc);
        else if (r < 0.6) this.radio.trigger("position", rc);
        else if (r < 0.7 && this.trackWetness > 0.2)
          this.radio.trigger("weather", rc);
        else if (r < 0.8 && this.flagState === "SC")
          this.radio.trigger("sc", rc);
        else this.radio.trigger("motivation", rc);
      }
    }

    if (this.flagState === "SC") {
      if (!this.scCar.active) {
        const activeCarsInit = this.cars.filter(
          (c) => !c.retired && c.inPitPhase === 0 && !c.finishedRace,
        );
        const leaderInit = activeCarsInit.sort((a, b) => a.uiPos - b.uiPos)[0];
        const spawnDist = leaderInit ? (leaderInit.dist + 0.05) % 1.0 : 0.04;
        this.scCar.active = true;
        this.scCar.dist = spawnDist;
        this.scCar.speed = MAX_BASE_SPEED * 0.28;
        this.scCar.laneOffset = 0.0;
      }
      const pInfoSC = this.track.getPointAt(this.scCar.dist % 1.0);
      const nextSCFrac = (this.scCar.dist + 0.012) % 1.0;
      const nextSCPt = this.track.getPointAt(nextSCFrac);
      const cvAheadSC = nextSCPt
        ? this.track.trackCurvature[nextSCPt.idx]?.val || 0
        : 0;
      const SC_MAX_SPEED = MAX_BASE_SPEED * (90 / 335);
      let targetScS = SC_MAX_SPEED * Math.exp(-cvAheadSC * 20);
      targetScS = Math.max(
        MAX_BASE_SPEED * 0.18,
        Math.min(targetScS, SC_MAX_SPEED),
      );

      const activeCars = this.cars.filter(
        (c) => !c.retired && c.inPitPhase === 0 && !c.finishedRace,
      );
      const leader = activeCars.sort((a, b) => a.uiPos - b.uiPos)[0];
      if (leader) {
        let scFrac = this.scCar.dist % 1.0,
          leaderFrac = leader.dist % 1.0;
        let scAheadOfLeader = (scFrac - leaderFrac + 1.0) % 1.0;
        if (scAheadOfLeader < 0.06 && scAheadOfLeader > 0.001)
          targetScS = Math.min(targetScS, leader.speed * 1.02);
        else if (scAheadOfLeader > 0.25)
          targetScS = Math.min(targetScS, MAX_BASE_SPEED * 0.22);
      }

      this.scCar.speed += (targetScS - this.scCar.speed) * 0.03 * dt;
      this.scCar.dist += this.scCar.speed * dt;
      if (pInfoSC) {
        this.scCar.x = pInfoSC.x;
        this.scCar.y = pInfoSC.y;
        this.scCar.tangAngle = Math.atan2(pInfoSC.tangY, pInfoSC.tangX);
      }
      this.scCar.displayKmh = (this.scCar.speed / MAX_BASE_SPEED) * 335;
    } else if (this.flagState === "GREEN" || this.flagState === "VSC") {
      this.scCar.active = false;
    }

    let evalCars = [...this.cars];
    if (this.scCar.active) evalCars.push(this.scCar);
    let allQD = true,
      allGridStop = true;

    const subSteps = 3;
    const dtSub = dt / subSteps;
    for (let stepLoop = 0; stepLoop < subSteps; stepLoop++) {
      this.cars.forEach((c, idx) => {
        if (stepLoop === 0) {
          if (this.state === "QUALIFYING") {
            if (c.qPhase !== "DONE" && !c.retired) allQD = false;
          }
          if (this.state === "GRID_WAIT") {
            if (
              c.launchState !== "JUMPED" &&
              Math.random() < 0.00005 * c.aggression
            ) {
              c.launchState = "JUMPED";
              c.timePenalty += 10;
              this.broadcast.triggerEvent({ type: "jump_start", car: c });
              this.addFIAMessage(`10s PENALTY - ${c.name} JUMP START`);
            }
          }

          if (
            c.dist > 0 &&
            !c.retired &&
            this.state !== "FORMATION" &&
            this.state !== "GRID_WAIT" &&
            this.state !== "GRID"
          ) {
            const frac = c.fraction;
            let tSec = frac < 0.35 ? 0 : frac < 0.7 ? 1 : 2;

            if (c.currentSector !== tSec && c.inPitPhase === 0) {
              if (
                c.currentLap > 1 ||
                tSec !== 0 ||
                this.state === "QUALIFYING"
              ) {
                let pBase = c.lapStartTime;
                for (let i = 0; i < c.currentSector; i++)
                  pBase += c.sectorTimes[i];
                c.sectorTimes[c.currentSector] = Math.max(
                  0.01,
                  this.raceTimerCount - pBase,
                );
              }

              if (tSec === 0 && c.currentSector === 2) {
                let fT = c.sectorTimes[0] + c.sectorTimes[1] + c.sectorTimes[2];

                if (this.state === "QUALIFYING") {
                  if (c.qPhase === "OUT_LAP") {
                    c.qPhase = "HOT_LAP";
                    c.lapStartTime = this.raceTimerCount;
                    c.sectorTimes = [0, 0, 0];
                    c.tyreTemps = [95, 95, 95, 95];
                  } else if (c.qPhase === "HOT_LAP") {
                    c.qPhase = "IN_LAP";
                    if (fT > 5) {
                      c.bestLap = fT;
                      this.addFIAMessage(`${c.name} TIMES ${fmtTime(fT)}`);
                      if (fT < this.fastestLapOverall) {
                        this.fastestLapOverall = fT;
                        this.broadcast.triggerEvent({ type: "q_pole", car: c });
                        this.camera.forceEventCut(c.id, 8, "fastestLap", 260);
                      }
                    }
                  }
                } else {
                  if (fT > 5 && !c.finishedRace) {
                    if (fT < c.bestLap) c.bestLap = fT;
                    if (
                      fT < this.fastestLapOverall &&
                      this.state !== "FINISHED" &&
                      this.flagState === "GREEN" &&
                      this.trackWetness < 0.05
                    ) {
                      this.fastestLapOverall = fT;
                      this.broadcast.triggerEvent({
                        type: "fastestLap",
                        car: c,
                      });
                      this.camera.forceEventCut(c.id, 5, "fastestLap", 300);
                    }
                  }
                  c.lapStartTime = this.raceTimerCount;
                  c.sectorTimes = [0, 0, 0];

                  if (
                    c.currentLap > TOTAL_LAPS &&
                    !c.finishedRace &&
                    (this.state === "GREEN" ||
                      this.state === "SC" ||
                      this.state === "VSC")
                  ) {
                    c.finishedRace = true;
                    this.carsFinished++;
                    c.finishPos = this.carsFinished;
                    c.finishTime = this.raceTimerCount + (c.timePenalty || 0);

                    if (this.carsFinished === 1) {
                      this.winnerFinishTime = c.finishTime;
                      let stt = document.getElementById("status-title");
                      if (stt) {
                        stt.textContent = `${c.name} WINS!`;
                        stt.style.opacity = 1;
                        setTimeout(() => {
                          stt.style.opacity = 0;
                        }, 8000);
                      }
                      this.broadcast.triggerEvent({ type: "finish", car: c });
                      this.camera.forceEventCut(c.id, 10, "finish", 500);
                    } else {
                      this.addFIAMessage(
                        `${c.name} CROSSED FINISH LINE - P${c.finishPos}`,
                      );
                    }
                  }
                }
              }
              c.currentSector = tSec;
            }

            if (c.inPitPhase > 0) {
              if (c.inPitPhase === 1 && !c.pitSpeedPenaltyIssued)
                this.camera.forceEventCut(c.id, 3, "pit", 200);
              if (
                (frac > 0.865 || frac < 0.035) &&
                c.displayKmh > 82 &&
                !c.pitSpeedPenaltyIssued
              ) {
                c.timePenalty += 5;
                c.pitSpeedPenaltyIssued = true;
                this.addFIAMessage(`5s PENALTY - ${c.name} - PIT SPEEDING`);
              }
              if (
                frac > 0.045 &&
                frac < 0.055 &&
                c.laneOffset < 1.2 &&
                !c.pitLinePenaltyIssued
              ) {
                c.timePenalty += 5;
                c.pitLinePenaltyIssued = true;
                this.addFIAMessage(`5s PENALTY - ${c.name} - CROSS PIT LINE`);
              }
            } else {
              if (frac > 0.1 && frac < 0.8) {
                c.pitSpeedPenaltyIssued = false;
                c.pitLinePenaltyIssued = false;
              }
            }
          }

          if (this.state === "FORMATION" && c.launchState !== "PARKED")
            allGridStop = false;

          c.aiUpdateTimer = (c.aiUpdateTimer || 0) - dtSub;
          if (
            c.aiUpdateTimer <= 0 ||
            this.state === "FORMATION" ||
            this.state === "GRID_WAIT"
          ) {
            c.lastIntents = AIController.evaluate(
              c,
              evalCars,
              this.track,
              this.flagState === "GREEN" ? this.state : this.flagState,
              { wet: this.trackWetness, rubber: this.trackRubber },
            );
            c.aiUpdateTimer = 6;
          }
        }

        const activeIntents = c.lastIntents || {
          tVel: c.speed,
          tLane: c.laneOffset,
          wGrip: 1.0,
          dirtyAir: false,
          wakeForce: 0,
          launchAccel: 1.0,
        };
        PhysicsEngine.apply(
          c,
          activeIntents,
          this.track,
          evalCars,
          this.flagState === "GREEN" ? this.state : this.flagState,
          { wet: this.trackWetness, rubber: this.trackRubber },
          dtSub,
          this,
        );
      });
      this.resolveCollisions(dtSub);
    }

    if (this.state === "QUALIFYING" && allQD) {
      this.transitionToRace();
    }
    if (this.state === "FORMATION" && allGridStop) {
      this.state = "GRID_WAIT";
      this.updateUIBanner();
      this.startSequence();
    }

    if (this.state === "QUALIFYING") {
      this.cars.forEach((c) => (c.uiPos = c.id + 1));
      let lbSorted = [...this.cars].sort(
        (a, b) => (a.bestLap || 999999) - (b.bestLap || 999999),
      );
      lbSorted.forEach((c, idx) => (c.uiPos = idx + 1));
    } else {
      const effDists = this.cars.map((c) => {
        if (c.retired) return { id: c.id, d: -9999 - (1.0 - c.dist / 1000) };
        if (c.finishedRace) return { id: c.id, d: 100000 - c.finishPos };
        return { id: c.id, d: c.dist - (c.timePenalty || 0) / 75.0 };
      });
      effDists.sort((a, b) => b.d - a.d);

      const oldState = this.cars.map((c) => ({ id: c.id, pos: c.uiPos }));
      this.cars.forEach((c) => {
        c.uiPos = effDists.findIndex((e) => e.id === c.id) + 1;
        if (
          this.state === "GREEN" &&
          c.dist > 0.05 &&
          c.inPitPhase === 0 &&
          !c.retired &&
          !c.finishedRace &&
          this.flagState === "GREEN" &&
          this.trackWetness < 0.3
        ) {
          let old = oldState.find((o) => o.id === c.id);
          if (old && old.pos > c.uiPos) {
            let v = oldState.find((o) => o.pos === c.uiPos);
            if (v) {
              this.broadcast.triggerEvent({
                type: "overtake",
                carA: c,
                carB: this.cars.find((x) => x.id === v.id),
                pos: c.uiPos,
              });
              this.camera.forceEventCut(c.id, 8, "overtake", 350);
            }
          }
        }
        if (this.state === "GREEN" && c.reactionTimer > 0)
          c.reactionTimer -= dt;
      });

      let activeRacingCars = this.cars.filter(
        (c) => !c.retired && !c.finishedRace,
      );
      if (
        this.carsFinished > 0 &&
        activeRacingCars.length === 0 &&
        this.state !== "FINISHED"
      ) {
        this.state = "FINISHED";
        this._clearRaceSnapshot();
        let stt = document.getElementById("status-title");
        if (stt) {
          stt.textContent = `SESSION ENDED`;
          stt.style.opacity = 1;
        }

        let finishOrder = this.cars
          .slice()
          .sort((a, b) => a.uiPos - b.uiPos)
          .filter((c) => c.finishedRace);
        this.championship.awardPoints(finishOrder, this.cars);

        const finalResults = this.cars
          .slice()
          .sort((a, b) => a.uiPos - b.uiPos)
          .map((c) => ({ driverName: c.name, pos: c.uiPos }));
        const sessionToken = localStorage.getItem("f1_token");
        if (sessionToken) {
          fetch(
            `${window.location.hostname === "localhost" ? "http://localhost:3000" : ""}/api/settle-bets`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionToken}`,
              },
              body: JSON.stringify({ raceResults: finalResults }),
            },
          )
            .then((res) => res.json())
            .then((data) => {
              if (data.details && data.details.length > 0) {
                document.getElementById("br-winnings").textContent =
                  data.winnings.toFixed(1);
                AUTH_STATE.tokens = data.newBalance;
                document.getElementById("display-tokens").textContent =
                  data.newBalance.toFixed(1);
                const dWrap = document.getElementById("br-details-wrap");
                dWrap.innerHTML = data.details
                  .map((bet) => {
                    const clr = bet.won > 0 ? "#00d2be" : "#e10600";
                    return `<div class="result-details"><span style="color:#aaa;">${bet.driver.toUpperCase()} [P${bet.pos}]</span> ➜ <span style="color:${clr}">RETURN: ${bet.won.toFixed(1)} TKN</span></div>`;
                  })
                  .join("");
                document.getElementById("bet-results-box").style.borderColor =
                  data.winnings > 0 ? "var(--green)" : "var(--red)";
                document
                  .getElementById("bet-results-modal")
                  .classList.add("show");
              }
            })
            .catch((e) => console.error(e));
          document.getElementById("close-br-btn").onclick = () =>
            document
              .getElementById("bet-results-modal")
              .classList.remove("show");
        }
        setTimeout(() => {
          if (this.championship) {
            this.championship.visible = true;
            const panel = document.getElementById("championship-panel");
            if (panel) panel.classList.add("show");
          }
        }, 3000);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      let p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= (1 / p.maxLife) * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.sprayParticles.length - 1; i >= 0; i--) {
      let p = this.sprayParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += 0.4 * dt;
      p.life -= (1 / p.maxLife) * dt;
      if (p.life <= 0) this.sprayParticles.splice(i, 1);
    }
    for (let i = this.speedGhosts.length - 1; i >= 0; i--) {
      let p = this.speedGhosts[i];
      p.life -= (1 / p.maxLife) * dt;
      if (p.life <= 0) this.speedGhosts.splice(i, 1);
    }
    for (let i = this.skidMarks.length - 1; i >= 0; i--) {
      let p = this.skidMarks[i];
      p.life -= (1 / p.maxLife) * dt * (this.trackWetness > 0.05 ? 5 : 1);
      if (p.life <= 0) this.skidMarks.splice(i, 1);
    }

    this.camera.update(this.cars, dt);
    this.drawCore();
    this.updateUI();

    const focusCar =
      this.cars.find((c) => c.id === this.camera.focusTargetId) || this.cars[0];
    if (this.telemetryGraph.visible) this.telemetryGraph.update(focusCar);
    if (this.gForceMeter.visible) this.gForceMeter.update(focusCar);

    if (focusCar && focusCar.isPorpoising && this.porpoisingFlashTimer <= 0) {
      this.porpoisingFlashTimer = 90;
    }

    if (document.hidden) {
      setTimeout(() => this.step(), 16);
    } else {
      requestAnimationFrame(() => this.step());
    }
  }

  updateUI() {
    const timerEl = document.getElementById("timer-display");
    if (timerEl)
      timerEl.textContent = `${String(Math.floor(this.raceTimerCount / 60)).padStart(2, "0")}:${(this.raceTimerCount % 60).toFixed(3).padStart(6, "0")}`;

    const lapEl = document.getElementById("lap-display");
    if (lapEl) {
      if (this.state === "QUALIFYING") lapEl.textContent = "Q1 SESSION";
      else if (this.state === "FORMATION" || this.state === "GRID_WAIT")
        lapEl.textContent = "FORMATION";
      else
        lapEl.textContent = `LAP ${Math.min(TOTAL_LAPS, [...this.cars].sort((a, b) => a.uiPos - b.uiPos)[0].currentLap)}/${TOTAL_LAPS}`;
    }

    let raceSortedDists = [];
    if (this.state !== "QUALIFYING") {
      raceSortedDists = this.cars
        .map((c) => ({
          id: c.id,
          d: c.retired
            ? -9999 - (1.0 - c.dist / 1000)
            : c.dist - c.timePenalty / 75.0,
        }))
        .sort((a, b) => b.d - a.d);
    }

    this.cars.forEach((c) => {
      let dt = "";
      if (this.state === "QUALIFYING") {
        if (c.bestLap === Infinity) dt = c.qPhase;
        else dt = fmtTime(c.bestLap);
      } else {
        if (c.finishedRace) {
          if (c.finishPos === 1) dt = "WINNER";
          else
            dt = `+${Math.max(0, c.finishTime - this.winnerFinishTime).toFixed(3)}s`;
        } else {
          let effLeader = raceSortedDists[0]?.d || 0;
          if (c.uiPos === 1) dt = "LEADER";
          else
            dt = `+${Math.max(0, (effLeader - (c.dist - c.timePenalty / 75.0)) * 75.0).toFixed(3)}s`;
        }
      }

      let domRow = document.getElementById(`lb-row-${c.id}`);
      if (domRow) {
        domRow.style.order = c.uiPos;
        domRow.className = `lb-row ${c.id === this.camera.focusTargetId ? "selected" : ""}`;
        if (c.retired) {
          domRow.classList.add("dnf-row");
        }
      }

      const gapEl = document.getElementById(`lb-gap-${c.id}`);
      if (gapEl) {
        if (c.retired) {
          gapEl.innerHTML = `<span class="out-tag">OUT</span>`;
        } else if (c.finishedRace && c.inPitPhase > 0) {
          gapEl.innerHTML = `<span class="out-tag" style="background:#555">PARC FERME</span>`;
        } else {
          gapEl.textContent = dt;
        }
      }
      const posEl = document.getElementById(`lb-pos-${c.id}`);
      if (posEl) {
        posEl.textContent = c.uiPos;
        posEl.className = `lb-pos p${Math.min(3, c.uiPos)}`;
      }
      const dotEl = document.getElementById(`lb-dot-${c.id}`);
      if (dotEl) dotEl.style.background = c.color;
      const nameEl = document.getElementById(`lb-name-${c.id}`);
      if (nameEl)
        nameEl.innerHTML =
          c.name +
          (c.timePenalty > 0
            ? `<span class="penalty-tag">+${c.timePenalty}s</span>`
            : "");

      const typeCfg = TYRES[c.tyreType] || TYRES["SOFT"];
      const lbTyreEl = document.getElementById(`lb-tyre-${c.id}`);
      if (lbTyreEl) {
        lbTyreEl.textContent = typeCfg.abbr;
        lbTyreEl.style.color = typeCfg.bg;
      }
      const wearEl = document.getElementById(`lb-wear-${c.id}`);
      if (wearEl)
        wearEl.textContent = Math.max(0, 100 - c.tyreWear).toFixed(0) + "%";
      let ersEl = document.getElementById(`lb-ers-${c.id}`);
      if (ersEl) {
        ersEl.textContent = Math.floor(c.ersBattery) + "%";
        ersEl.style.color =
          c.ersMode === "DEPLOY"
            ? "var(--blue)"
            : c.ersMode === "DEFEND"
              ? "var(--orange)"
              : "var(--yellow)";
      }

      const spdEl = document.getElementById(`lb-spd-${c.id}`);
      if (spdEl) spdEl.textContent = c.displayKmh.toFixed(0);
      const pitEl = document.getElementById(`lb-pit-${c.id}`);
      if (pitEl) pitEl.textContent = c.inPitPhase > 0 ? "PIT" : c.pitStops;
    });

    const l =
      this.cars.find((c) => c.id === this.camera.focusTargetId) || this.cars[0];

    const dName = document.getElementById("detail-pos-name");
    if (dName) dName.textContent = `P${l.uiPos} — ${l.name}`;
    const dTeam = document.getElementById("detail-team-name");
    if (dTeam) dTeam.textContent = l.teamName.toUpperCase();
    const dStrp = document.getElementById("detail-team-stripe");
    if (dStrp) dStrp.style.background = l.color;

    const tSpd = document.getElementById("tel-spd");
    if (tSpd) tSpd.textContent = `${l.displayKmh.toFixed(0)} KM/H`;
    const bSpd = document.getElementById("bar-spd");
    if (bSpd)
      bSpd.style.width =
        Math.max(0, Math.min(100, (l.displayKmh / 360) * 100)) + "%";

    const tGear = document.getElementById("tel-gear");
    if (tGear) tGear.textContent = l.gear;
    const bRpm = document.getElementById("bar-rpm");
    if (bRpm) {
      let rpmPercent = Math.max(
        0,
        Math.min(100, ((l.rpm - 4000) / 8000) * 100),
      );
      bRpm.style.width = rpmPercent + "%";
    }

    const tThr = document.getElementById("tel-thr");
    if (tThr) tThr.textContent = (l.throttlePercent * 100).toFixed(0) + "%";
    const bThr = document.getElementById("bar-thr");
    if (bThr)
      bThr.style.width =
        Math.max(0, Math.min(100, l.throttlePercent * 100)) + "%";

    const tBrk = document.getElementById("tel-brk");
    if (tBrk) tBrk.textContent = (l.brakeActive ? 100 : 0) + "%";
    const bBrk = document.getElementById("bar-brk");
    if (bBrk)
      bBrk.style.width =
        Math.max(0, Math.min(100, l.brakeActive ? 100 : 0)) + "%";

    const tErs = document.getElementById("tel-ers");
    const bErs = document.getElementById("bar-ers");
    if (tErs && bErs) {
      let ersCol = "var(--yellow)";
      if (l.ersMode === "DEPLOY") ersCol = "var(--blue)";
      if (l.ersMode === "DEFEND") ersCol = "var(--orange)";
      tErs.textContent = l.ersMode;
      tErs.style.color = ersCol;
      bErs.style.background = ersCol;
      bErs.style.width = Math.max(0, Math.min(100, l.ersBattery)) + "%";
    }

    const tPace = document.getElementById("tel-pace");
    if (tPace) {
      let paceCol = "var(--yellow)";
      if (this.state === "FORMATION" || this.state === "GRID_WAIT") {
        paceCol = "var(--yellow)";
        tPace.textContent = "GRID";
        tPace.style.color = paceCol;
      } else {
        if (l.paceMode === "PUSH") paceCol = "var(--blue)";
        else if (l.paceMode === "SAVE" || l.paceMode === "COOLDOWN")
          paceCol = "var(--green)";
        tPace.textContent = l.paceMode;
        tPace.style.color = paceCol;
      }
    }

    const tTypeCfg = TYRES[l.tyreType] || TYRES["SOFT"];
    const tOpt = tTypeCfg.optTemp;
    const tRng = tTypeCfg.tempRange;
    ["fl", "fr", "rl", "rr"].forEach((boxId, idx) => {
      let e = document.getElementById("tt-" + boxId);
      if (e) {
        e.textContent = Math.floor(l.tyreTemps[idx]) + "°";
        e.style.background = getTempColor(l.tyreTemps[idx], tOpt, tRng);
      }
    });

    const tTyre = document.getElementById("tel-tyre");
    const bTyre = document.getElementById("bar-tyre");
    if (tTyre && bTyre) {
      let tyreHealthPercent = Math.max(0, 100 - l.tyreWear);
      let tCol =
        tyreHealthPercent < 30
          ? "var(--red)"
          : tyreHealthPercent < 60
            ? "var(--yellow)"
            : "var(--green)";
      tTyre.textContent = tyreHealthPercent.toFixed(0) + "%";
      tTyre.style.color = tCol;
      bTyre.style.background = tCol;
      bTyre.style.width = Math.max(0, Math.min(100, tyreHealthPercent)) + "%";
    }

    const tTType = document.getElementById("tel-tyre-type");
    if (tTType) {
      tTType.textContent = tTypeCfg.label;
      tTType.style.color = tTypeCfg.bg;
    }

    const tGapAhead = document.getElementById("tel-gap-ahead");
    if (tGapAhead) {
      if (
        l.uiPos === 1 ||
        this.state === "QUALIFYING" ||
        this.state === "FORMATION" ||
        this.state === "GRID_WAIT"
      ) {
        tGapAhead.textContent = "LEADER";
      } else {
        let racePosArr = [...this.cars].sort((a, b) => a.uiPos - b.uiPos);
        let myD = raceSortedDists.find((e) => e.id === l.id)?.d || 0;
        let carAheadId = racePosArr[l.uiPos - 2]?.id;
        if (carAheadId !== undefined) {
          let aheadD = raceSortedDists.find((e) => e.id === carAheadId)?.d || 0;
          tGapAhead.textContent =
            "+" + ((aheadD - myD) * 75.0).toFixed(3) + "s";
        } else {
          tGapAhead.textContent = "---";
        }
      }
    }

    const tPits = document.getElementById("tel-pits");
    if (tPits)
      tPits.textContent = l.inPitPhase > 0 ? "PITTING" : `STOPS: ${l.pitStops}`;
    const tDrs = document.getElementById("tel-drs");
    if (tDrs) {
      tDrs.textContent = l.drsActive ? "ON" : "OFF";
      tDrs.style.color = l.drsActive ? "var(--green)" : "#aaa";
    }

    [0, 1, 2].forEach((k) => {
      const txt =
        l.sectorTimes[k] > 0 ? l.sectorTimes[k].toFixed(3) + "s" : "—.———";
      const sv = document.getElementById("s" + (k + 1) + "-val");
      if (sv) sv.textContent = txt;
      const dv = document.getElementById("ds" + (k + 1) + "-val");
      if (dv) dv.textContent = txt;
    });

    const tBest = document.getElementById("ds-best");
    if (tBest) tBest.textContent = fmtTime(l.bestLap);

    const dsStat = document.getElementById("ds-status");
    if (dsStat) {
      let incTxt = "CLEAN";
      let iClr = "#aaa";
      if (l.retired) {
        incTxt = `RETIRED - ${l.dnfType}`;
        iClr = "var(--red)";
      } else if (l.hasWingDamage) {
        incTxt = "WING DMG";
        iClr = "var(--yellow)";
      } else if (l.hasPuncture) {
        incTxt = "PUNCTURE";
        iClr = "var(--orange)";
      }
      dsStat.textContent = incTxt;
      dsStat.style.color = iClr;
    }

    const tFuel = document.getElementById("tel-fuel");
    const bFuel = document.getElementById("bar-fuel");
    if (tFuel && bFuel) {
      const fc = l.fuelLoad;
      tFuel.textContent = fc.toFixed(1) + " KG";
      let fuelCol =
        fc < 10 ? "var(--red)" : fc < 25 ? "var(--yellow)" : "var(--orange)";
      tFuel.style.color = fuelCol;
      bFuel.style.background = fuelCol;
      bFuel.style.width = Math.max(0, Math.min(100, (fc / 110) * 100)) + "%";
    }

    const lcBadge = document.getElementById("liftcoast-badge");
    if (lcBadge) lcBadge.classList.toggle("active", l.isLiftCoasting);

    const tTL = document.getElementById("tel-tl");
    if (tTL) {
      if (l.trackLimitsWarnings === 0) {
        tTL.textContent = "CLEAN";
        tTL.style.color = "#aaa";
      } else if (l.trackLimitsWarnings === 1) {
        tTL.textContent = "⚠ 1 WARN";
        tTL.style.color = "var(--yellow)";
      } else if (l.trackLimitsWarnings >= 2) {
        tTL.textContent = "⚠ PENALTY";
        tTL.style.color = "var(--red)";
      }
    }

    const dInd = document.getElementById("drs-indicator");
    if (dInd) {
      if (l.drsActive) dInd.classList.add("active");
      else dInd.classList.remove("active");
    }
    if (this.state === "GREEN" || this.state === "QUALIFYING") {
      this.delta.update(l, this.state);
    }

    const tLatG = document.getElementById("tel-latg");
    const bLatG = document.getElementById("bar-latg");
    if (tLatG && bLatG) {
      let lg = Math.abs(l.lateralG || 0);
      let lgCol =
        lg > 4 ? "var(--red)" : lg > 2.5 ? "var(--orange)" : "var(--pink)";
      tLatG.textContent = lg.toFixed(1) + "G";
      tLatG.style.color = lgCol;
      bLatG.style.background = lgCol;
      bLatG.style.width = Math.min(100, (lg / 6) * 100) + "%";
    }

    const tSlip = document.getElementById("tel-slip");
    const bSlip = document.getElementById("bar-slip");
    if (tSlip && bSlip) {
      let sa = Math.abs(l.slipAngle || 0);
      let saCol =
        sa > 10 ? "var(--red)" : sa > 5 ? "var(--orange)" : "var(--green)";
      tSlip.textContent = sa.toFixed(1) + "°";
      tSlip.style.color = saCol;
      bSlip.style.background = saCol;
      bSlip.style.width = Math.min(100, (sa / 15) * 100) + "%";
    }

    const tCond = document.getElementById("tel-tycond");
    if (tCond) {
      let condTxt = "NOMINAL",
        condCol = "#aaa";
      if ((l.blistering || 0) > 0.3) {
        condTxt = "🔥 BLISTERING";
        condCol = "var(--red)";
      } else if ((l.graining || 0) > 0.4) {
        condTxt = "🌀 GRAINING";
        condCol = "var(--yellow)";
      } else if (l.wingDamageLevel >= 2) {
        condTxt = "💥 WING BROKEN";
        condCol = "var(--orange)";
      } else if (l.hasWingDamage) {
        condTxt = "⚠ WING DMG";
        condCol = "var(--yellow)";
      } else if ((l.flatSpots || []).some((f) => f > 0.3)) {
        condTxt = "⬛ FLAT SPOT";
        condCol = "#888";
      } else if (l.isPorpoising) {
        condTxt = "〰 PORPOISING";
        condCol = "var(--orange)";
      }
      tCond.textContent = condTxt;
      tCond.style.color = condCol;
    }

    const tDf = document.getElementById("tel-df");
    if (tDf) {
      let df = Math.round((l.downforce || 0) * 1e6);
      tDf.textContent = (df / 1000).toFixed(1) + " kN";
      tDf.style.color = df > 800 ? "var(--blue)" : "#555";
    }

    const tPsi = document.getElementById("tel-psi");
    if (tPsi && l.tyrePressure) {
      tPsi.innerHTML = `FL:${l.tyrePressure[0].toFixed(1)} FR:${l.tyrePressure[1].toFixed(1)}<br>RL:${l.tyrePressure[2].toFixed(1)} RR:${l.tyrePressure[3].toFixed(1)}`;
    }
  }

  drawCore() {
    const w = this.ctx.canvas.width,
      h = this.ctx.canvas.height;
    const grad = this.ctx.createRadialGradient(
      w / 2,
      h / 2,
      0,
      w / 2,
      h / 2,
      Math.max(w, h),
    );
    grad.addColorStop(0, "#0d1018");
    grad.addColorStop(1, "#060810");
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, w, h);

    this.camera.applyTransform(this.ctx);
    this.ctx.lineJoin = "round";
    this.ctx.lineCap = "round";

    let rTr = Math.floor(50 - 30 * this.trackWetness);
    let gTr = Math.floor(55 - 30 * this.trackWetness);
    let bTr = Math.floor(64 - 24 * this.trackWetness);
    let mainHex = `rgb(${rTr},${gTr},${bTr})`;
    let borderHex = `rgb(${Math.max(10, rTr - 10)},${Math.max(10, gTr - 10)},${Math.max(10, bTr - 5)})`;

    this.ctx.beginPath();
    this.track.trackPoints.forEach((p, i) =>
      i === 0 ? this.ctx.moveTo(p[0], p[1]) : this.ctx.lineTo(p[0], p[1]),
    );
    this.ctx.closePath();
    this.ctx.lineWidth = TRACK_WIDTH_PX + 28;
    this.ctx.strokeStyle = "rgba(50,55,45,0.4)";
    this.ctx.stroke();
    this.ctx.lineWidth = TRACK_WIDTH_PX + 12;
    this.ctx.strokeStyle = borderHex;
    this.ctx.stroke();
    this.ctx.lineWidth = TRACK_WIDTH_PX + 2;
    this.ctx.strokeStyle = `rgb(${rTr - 5},${gTr - 5},${bTr - 5})`;
    this.ctx.stroke();

    this.ctx.lineWidth = TRACK_WIDTH_PX * 0.45;
    this.ctx.strokeStyle = mainHex;
    this.ctx.beginPath();
    for (let f = 0.835; f <= 1.065; f += 0.005) {
      let realF = f % 1.0;
      let pInfo = this.track.getPointAt(realF);
      let laneOff = 2.8;
      if (f < 0.865) laneOff = 1.0 + 1.8 * ((f - 0.835) / 0.03);
      else if (f > 1.035) laneOff = 1.0 + 1.8 * ((1.065 - f) / 0.03);
      let px = pInfo.x + (pInfo.nx * laneOff * TRACK_WIDTH_PX) / 2.2,
        py = pInfo.y + (pInfo.ny * laneOff * TRACK_WIDTH_PX) / 2.2;
      if (f === 0.835) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.stroke();

    this.ctx.lineWidth = 4;
    this.ctx.strokeStyle = "#556677";
    this.ctx.beginPath();
    for (let f = 0.865; f <= 1.04; f += 0.005) {
      let realF = f % 1.0;
      let pInfo = this.track.getPointAt(realF);
      let px = pInfo.x + (pInfo.nx * 1.55 * TRACK_WIDTH_PX) / 2.2,
        py = pInfo.y + (pInfo.ny * 1.55 * TRACK_WIDTH_PX) / 2.2;
      if (f === 0.865) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.stroke();

    let lEnP = this.track.getPointAt(0.865);
    this.ctx.strokeStyle = "#e10600";
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(
      lEnP.x + (lEnP.nx * 1.6 * TRACK_WIDTH_PX) / 2.2,
      lEnP.y + (lEnP.ny * 1.6 * TRACK_WIDTH_PX) / 2.2,
    );
    this.ctx.lineTo(
      lEnP.x + (lEnP.nx * 4.0 * TRACK_WIDTH_PX) / 2.2,
      lEnP.y + (lEnP.ny * 4.0 * TRACK_WIDTH_PX) / 2.2,
    );
    this.ctx.stroke();
    let lExP = this.track.getPointAt(0.035);
    this.ctx.strokeStyle = "#00ff44";
    this.ctx.beginPath();
    this.ctx.moveTo(
      lExP.x + (lExP.nx * 1.6 * TRACK_WIDTH_PX) / 2.2,
      lExP.y + (lExP.ny * 1.6 * TRACK_WIDTH_PX) / 2.2,
    );
    this.ctx.lineTo(
      lExP.x + (lExP.nx * 4.0 * TRACK_WIDTH_PX) / 2.2,
      lExP.y + (lExP.ny * 4.0 * TRACK_WIDTH_PX) / 2.2,
    );
    this.ctx.stroke();

    for (let idx = 0; idx < NUM_CARS; idx++) {
      let bInfo = this.track.getPointAt(0.88 + idx * 0.004),
        bx = bInfo.x + (bInfo.nx * 3.8 * TRACK_WIDTH_PX) / 2.2,
        by = bInfo.y + (bInfo.ny * 3.8 * TRACK_WIDTH_PX) / 2.2;
      this.ctx.fillStyle = `rgba(${(F1_TEAMS[DRIVER_DB[idx].t].c.replace("#", "0x") >> 16) & 255}, ${(F1_TEAMS[DRIVER_DB[idx].t].c.replace("#", "0x") >> 8) & 255}, ${F1_TEAMS[DRIVER_DB[idx].t].c.replace("#", "0x") & 255}, 0.15)`;
      this.ctx.save();
      this.ctx.translate(bx, by);
      this.ctx.rotate(Math.atan2(bInfo.tangY, bInfo.tangX));
      this.ctx.fillRect(-12, -4, 24, 8);
      this.ctx.restore();
    }

    this.ctx.lineWidth = TRACK_WIDTH_PX * 2.2;
    this.ctx.strokeStyle = "#1a2a10";
    this.ctx.beginPath();
    this.track.trackPoints.forEach((p, i) =>
      i === 0 ? this.ctx.moveTo(p[0], p[1]) : this.ctx.lineTo(p[0], p[1]),
    );
    this.ctx.closePath();
    this.ctx.stroke();

    this.ctx.lineWidth = TRACK_WIDTH_PX * 3.0;
    this.ctx.strokeStyle = "#2a2210";
    this.ctx.globalAlpha = 0.5;
    this.ctx.beginPath();
    this.track.trackPoints.forEach((p, i) =>
      i === 0 ? this.ctx.moveTo(p[0], p[1]) : this.ctx.lineTo(p[0], p[1]),
    );
    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.globalAlpha = 1.0;

    this.ctx.lineWidth = TRACK_WIDTH_PX;
    this.ctx.strokeStyle = mainHex;
    this.ctx.beginPath();
    this.track.trackPoints.forEach((p, i) =>
      i === 0 ? this.ctx.moveTo(p[0], p[1]) : this.ctx.lineTo(p[0], p[1]),
    );
    this.ctx.closePath();
    this.ctx.stroke();

    const segs = this.track.trackPoints.length;

    if (this.trackRubber > 0.01) {
      this.ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        let idx = i % segs;
        let p = this.track.trackPoints[idx];
        let nx = -(this.track.trackPoints[(i + 1) % segs][1] - p[1]);
        let ny = this.track.trackPoints[(i + 1) % segs][0] - p[0];
        let d = Math.hypot(nx, ny) + 0.001;
        nx /= d;
        ny /= d;
        let io = this.track.trackIdealLanes[idx];
        let rubberIntensity =
          trackRubberMap && trackRubberMap.length > idx
            ? trackRubberMap[idx]
            : this.trackRubber;
        let px = p[0] + (nx * io * TRACK_WIDTH_PX) / 2.2;
        let py = p[1] + (ny * io * TRACK_WIDTH_PX) / 2.2;
        if (i === 0) this.ctx.moveTo(px, py);
        else this.ctx.lineTo(px, py);
      }
      this.ctx.lineWidth = TRACK_WIDTH_PX * 0.38;
      this.ctx.strokeStyle = `rgba(8, 8, 8, ${this.trackRubber * 0.55})`;
      this.ctx.stroke();

      [-1, 1].forEach((offMod) => {
        this.ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
          let idx = i % segs;
          let p = this.track.trackPoints[idx];
          let nx = -(this.track.trackPoints[(i + 1) % segs][1] - p[1]);
          let ny = this.track.trackPoints[(i + 1) % segs][0] - p[0];
          let d = Math.hypot(nx, ny) + 0.001;
          nx /= d;
          ny /= d;
          let marbleIntensity =
            trackMarbleMap && trackMarbleMap.length > idx
              ? trackMarbleMap[idx]
              : this.trackRubber * 0.5;
          let marbleOff = this.track.trackIdealLanes[idx] + offMod * 0.58;
          let px = p[0] + (nx * marbleOff * TRACK_WIDTH_PX) / 2.2;
          let py = p[1] + (ny * marbleOff * TRACK_WIDTH_PX) / 2.2;
          if (i === 0) this.ctx.moveTo(px, py);
          else this.ctx.lineTo(px, py);
        }
        this.ctx.setLineDash([1, 16]);
        this.ctx.lineWidth = TRACK_WIDTH_PX * 0.18;
        this.ctx.strokeStyle = `rgba(90, 88, 80, ${this.trackRubber * 0.7})`;
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      });
    }

    this.skidMarks.forEach((sk) => {
      this.ctx.save();
      this.ctx.translate(sk.x, sk.y);
      this.ctx.rotate(sk.a);
      this.ctx.globalAlpha = Math.max(
        0,
        sk.life * (this.trackWetness > 0.05 ? 0.3 : 1.0),
      );
      this.ctx.fillStyle = "#0a0a0a";
      this.ctx.fillRect(-12, -CAR_WIDTH * 0.48 - 1, 4, 3);
      this.ctx.fillRect(-12, CAR_WIDTH * 0.48 - 1, 4, 3);
      this.ctx.fillRect(8, -CAR_WIDTH * 0.48 - 1, 4, 3);
      this.ctx.fillRect(8, CAR_WIDTH * 0.48 - 1, 4, 3);
      this.ctx.restore();
    });

    for (let i = 0; i < segs; i++) {
      const f = i / segs,
        p1 = this.track.trackPoints[i],
        p2 = this.track.trackPoints[(i + 1) % segs];
      this.ctx.strokeStyle =
        f < 0.35
          ? "rgba(0,150,255,0.04)"
          : f < 0.7
            ? "rgba(0,210,100,0.04)"
            : "rgba(200,100,255,0.04)";
      this.ctx.lineWidth = TRACK_WIDTH_PX - 2;
      this.ctx.beginPath();
      this.ctx.moveTo(p1[0], p1[1]);
      this.ctx.lineTo(p2[0], p2[1]);
      this.ctx.stroke();
      const nx = -(p2[1] - p1[1]) / Math.hypot(p2[0] - p1[0], p2[1] - p1[1]),
        ny = (p2[0] - p1[0]) / Math.hypot(p2[0] - p1[0], p2[1] - p1[1]),
        kOff = TRACK_WIDTH_PX / 2 + 1;
      this.ctx.strokeStyle =
        Math.floor(i / 2) % 2 === 0
          ? "rgba(225,6,0,0.85)"
          : "rgba(255,255,255,0.75)";
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(p1[0] + nx * kOff, p1[1] + ny * kOff);
      this.ctx.lineTo(p2[0] + nx * kOff, p2[1] + ny * kOff);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(p1[0] - nx * kOff, p1[1] - ny * kOff);
      this.ctx.lineTo(p2[0] - nx * kOff, p2[1] - ny * kOff);
      this.ctx.stroke();
    }

    this.speedGhosts.forEach((g) => {
      this.ctx.save();
      this.ctx.translate(g.x, g.y);
      this.ctx.rotate(g.a);
      this.ctx.globalAlpha = Math.max(0, g.life);
      this.ctx.fillStyle = g.c.color;
      this.ctx.beginPath();
      this.ctx.roundRect(
        -CAR_LENGTH * 0.4,
        -CAR_WIDTH * 0.42,
        CAR_LENGTH * 0.75,
        CAR_WIDTH * 0.84,
        2,
      );
      this.ctx.fill();
      this.ctx.restore();
    });

    if (this.scCar.active) {
      this.ctx.save();
      this.ctx.translate(this.scCar.x, this.scCar.y);
      this.ctx.rotate(this.scCar.tangAngle);
      this.ctx.fillStyle = "#ff6600";
      this.ctx.beginPath();
      this.ctx.roundRect(
        -CAR_LENGTH * 0.4,
        -CAR_WIDTH * 0.42,
        CAR_LENGTH * 0.75,
        CAR_WIDTH * 0.84,
        2,
      );
      this.ctx.fill();
      if (this.frames % 30 < 15) {
        this.ctx.fillStyle = "#ffff00";
      } else {
        this.ctx.fillStyle = "#ff8800";
      }
      this.ctx.shadowColor = this.ctx.fillStyle;
      this.ctx.shadowBlur = 15;
      this.ctx.fillRect(-6, -CAR_WIDTH * 0.25, 8, CAR_WIDTH * 0.5);
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = "#111";
      this.ctx.font = "800 6px Orbitron";
      this.ctx.fillText("SC", -4.5, 2.5);
      this.ctx.restore();
    }

    this.cars
      .slice()
      .sort((a, b) => a.dist - b.dist)
      .forEach((car) => {
        if (isNaN(car.x)) return;

        if (this.trackWetness > 0.05) {
          this.ctx.save();
          this.ctx.translate(car.x - 3, car.y + 6);
          this.ctx.rotate(car.tangAngle);
          this.ctx.globalAlpha = 0.2 * this.trackWetness;
          this.ctx.fillStyle = car.color;
          this.ctx.beginPath();
          this.ctx.roundRect(
            -CAR_LENGTH * 0.4,
            -CAR_WIDTH * 0.42,
            CAR_LENGTH * 0.75,
            CAR_WIDTH * 0.84,
            2,
          );
          this.ctx.fill();
          this.ctx.restore();
        }

        this.ctx.save();
        this.ctx.translate(car.x, car.y);
        this.ctx.rotate(car.tangAngle);

        if (
          car.id === this.camera.focusTargetId &&
          this.camera.mode !== "track"
        ) {
          this.ctx.shadowColor = car.color;
          this.ctx.shadowBlur = 24;
        }

        if (car.brakeGlow > 0 && !car.inPitPhase) {
          this.ctx.save();
          this.ctx.translate(
            CAR_LENGTH * 0.28 + CAR_LENGTH * 0.11,
            CAR_WIDTH * 0.48,
          );
          this.ctx.shadowBlur = 10 * car.brakeGlow;
          this.ctx.shadowColor = `rgba(255, ${100 - car.brakeGlow * 100}, 0, ${car.brakeGlow})`;
          this.ctx.fillStyle = `rgba(255, ${100 - car.brakeGlow * 100}, 0, ${car.brakeGlow})`;
          this.ctx.beginPath();
          this.ctx.arc(0, 0, CAR_WIDTH * 0.25, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.restore();
          this.ctx.save();
          this.ctx.translate(
            CAR_LENGTH * 0.28 + CAR_LENGTH * 0.11,
            -CAR_WIDTH * 0.48,
          );
          this.ctx.shadowBlur = 10 * car.brakeGlow;
          this.ctx.shadowColor = `rgba(255, ${100 - car.brakeGlow * 100}, 0, ${car.brakeGlow})`;
          this.ctx.fillStyle = `rgba(255, ${100 - car.brakeGlow * 100}, 0, ${car.brakeGlow})`;
          this.ctx.beginPath();
          this.ctx.arc(0, 0, CAR_WIDTH * 0.25, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.restore();
        }

        this.ctx.fillStyle = "#101010";
        this.ctx.beginPath();
        [-1, 1].forEach((side) => {
          [-1, 1].forEach((ax) => {
            this.ctx.save();
            let wx = ax > 0 ? CAR_LENGTH * 0.28 : -CAR_LENGTH * 0.35;
            this.ctx.translate(wx + CAR_LENGTH * 0.11, side * CAR_WIDTH * 0.48);
            if (ax > 0) this.ctx.rotate(car.steerAngle * 2.0);
            this.ctx.roundRect(
              -CAR_LENGTH * 0.11,
              -CAR_WIDTH * 0.14,
              CAR_LENGTH * 0.22,
              CAR_WIDTH * 0.28,
              2,
            );
            this.ctx.fill();
            this.ctx.restore();
          });
        });

        this.ctx.translate(car.bodyPitch, car.bodyRoll);

        this.ctx.fillStyle = "#111";
        this.ctx.beginPath();
        this.ctx.roundRect(
          -CAR_LENGTH * 0.4,
          -CAR_WIDTH * 0.42,
          CAR_LENGTH * 0.75,
          CAR_WIDTH * 0.84,
          2,
        );
        this.ctx.fill();
        this.ctx.fillStyle = car.accent;
        this.ctx.beginPath();
        this.ctx.roundRect(
          CAR_LENGTH * 0.36,
          -CAR_WIDTH * 0.48,
          CAR_LENGTH * 0.14,
          CAR_WIDTH * 0.96,
          2,
        );
        this.ctx.fill();
        this.ctx.fillStyle = car.color;
        this.ctx.beginPath();
        this.ctx.moveTo(CAR_LENGTH * 0.5, -CAR_WIDTH * 0.1);
        this.ctx.lineTo(CAR_LENGTH * 0.2, -CAR_WIDTH * 0.12);
        this.ctx.lineTo(CAR_LENGTH * 0.1, -CAR_WIDTH * 0.42);
        this.ctx.lineTo(-CAR_LENGTH * 0.2, -CAR_WIDTH * 0.42);
        this.ctx.lineTo(-CAR_LENGTH * 0.38, -CAR_WIDTH * 0.25);
        this.ctx.lineTo(-CAR_LENGTH * 0.48, -CAR_WIDTH * 0.25);
        this.ctx.lineTo(-CAR_LENGTH * 0.48, CAR_WIDTH * 0.25);
        this.ctx.lineTo(-CAR_LENGTH * 0.38, CAR_WIDTH * 0.25);
        this.ctx.lineTo(-CAR_LENGTH * 0.2, CAR_WIDTH * 0.42);
        this.ctx.lineTo(CAR_LENGTH * 0.1, CAR_WIDTH * 0.42);
        this.ctx.lineTo(CAR_LENGTH * 0.2, CAR_WIDTH * 0.12);
        this.ctx.lineTo(CAR_LENGTH * 0.5, CAR_WIDTH * 0.1);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.fillStyle = "#0a0a0a";
        this.ctx.beginPath();
        this.ctx.ellipse(
          -CAR_LENGTH * 0.05,
          0,
          CAR_LENGTH * 0.15,
          CAR_WIDTH * 0.18,
          0,
          0,
          Math.PI * 2,
        );
        this.ctx.fill();

        if (
          car.ersMode === "HARV" &&
          car.speed > MAX_BASE_SPEED * 0.3 &&
          Math.floor(this.frames) % 20 < 10
        ) {
          this.ctx.fillStyle = "#ff0000";
          this.ctx.shadowColor = "#ff0000";
          this.ctx.shadowBlur = 12;
          this.ctx.fillRect(-CAR_LENGTH * 0.45, -2, 2, 4);
          this.ctx.shadowBlur = 0;
        }

        if (this.trackWetness > 0) {
          const tCfg = TYRES[car.tyreType] || TYRES["SOFT"];
          this.ctx.fillStyle = tCfg.bg;
          this.ctx.fillRect(-CAR_LENGTH * 0.1, 0, 4, 4);
        }

        if (car.hasBrokenWing || car.wingDamageLevel >= 2) {
          this.ctx.save();
          this.ctx.translate(CAR_LENGTH * 0.5, 0);
          this.ctx.rotate(Math.sin(this.frames * 0.3) * 0.4);
          this.ctx.fillStyle = car.color;
          this.ctx.globalAlpha = 0.8;
          this.ctx.fillRect(0, -CAR_WIDTH * 0.6, CAR_LENGTH * 0.25, 3);
          this.ctx.globalAlpha = 1;
          this.ctx.restore();
        } else if (car.hasWingDamage && car.wingDamageLevel === 1) {
          this.ctx.save();
          this.ctx.translate(CAR_LENGTH * 0.5, 0);
          this.ctx.rotate(0.25);
          this.ctx.fillStyle = car.color;
          this.ctx.globalAlpha = 0.6;
          this.ctx.fillRect(-2, -CAR_WIDTH * 0.5, CAR_LENGTH * 0.18, 3);
          this.ctx.globalAlpha = 1;
          this.ctx.restore();
        }

        if (car.hasPuncture && car.displayKmh > 50) {
          if (Math.floor(this.frames) % 4 < 2) {
            this.ctx.save();
            this.ctx.translate(CAR_LENGTH * 0.28, CAR_WIDTH * 0.48);
            this.ctx.fillStyle = "#ffaa00";
            this.ctx.shadowColor = "#ffaa00";
            this.ctx.shadowBlur = 8;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
            this.ctx.restore();
          }
        }

        if (car.graining > 0.4) {
          this.ctx.save();
          this.ctx.globalAlpha = car.graining * 0.3;
          this.ctx.fillStyle = "#999";
          this.ctx.fillRect(
            CAR_LENGTH * 0.17,
            CAR_WIDTH * 0.35,
            CAR_LENGTH * 0.22,
            CAR_WIDTH * 0.28,
          );
          this.ctx.restore();
        }

        if (car.wheelspin > 0.5 && Math.floor(this.frames) % 3 === 0) {
          this.ctx.save();
          this.ctx.translate(-CAR_LENGTH * 0.38, 0);
          this.ctx.globalAlpha = car.wheelspin * 0.4;
          let sgrd = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 6);
          sgrd.addColorStop(0, "rgba(240,230,200,0.8)");
          sgrd.addColorStop(1, "rgba(220,210,180,0)");
          this.ctx.fillStyle = sgrd;
          this.ctx.beginPath();
          this.ctx.arc(0, 0, 6 + car.wheelspin * 4, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.restore();
        }

        if (car.isPorpoising) {
          let pOsc = Math.sin(this.frames * 0.8) * 2;
          this.ctx.translate(0, pOsc);
        }
        this.ctx.restore();
      });

    this.sprayParticles.forEach((p) => {
      this.ctx.fillStyle = `rgba(180, 200, 220, ${Math.max(0, p.life * 0.25)})`;
      this.ctx.beginPath();
      this.ctx.arc(
        p.x,
        p.y,
        Math.max(0.1, p.size * (2 - p.life)),
        0,
        Math.PI * 2,
      );
      this.ctx.fill();
    });

    this.particles.forEach((p) => {
      if (p.type === "spark") {
        this.ctx.strokeStyle = "#fffcf0";
        this.ctx.lineWidth = 1.5;
        this.ctx.shadowBlur = 8;
        this.ctx.shadowColor = p.clr;
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
        this.ctx.lineTo(p.x - p.vx * 1.5, p.y - p.vy * 1.5);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
      } else if (p.type === "smoke") {
        this.ctx.fillStyle = p.clr;
        this.ctx.globalAlpha = Math.max(0, p.life * 0.5);
        let rad = Math.max(1, 3 + (1.0 - p.life) * 15);
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1.0;
      } else {
        this.ctx.fillStyle = p.clr;
        this.ctx.globalAlpha = Math.max(0, p.life);
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, Math.max(0.1, 1 + p.life * 2), 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1.0;
      }
    });

    this.camera.restore(this.ctx);

    if (this.rainIntensity > 0.05) {
      if (!this._rainDrops || this._rainDrops.length === 0) {
        this._rainDrops = [];
        const POOL = 1200;
        for (let i = 0; i < POOL; i++) {
          this._rainDrops.push({
            x: Math.random() * w,
            y: Math.random() * h,
            speedY: 18 + Math.random() * 28,
            speedX: -2 + Math.random() * 4,
            len: 8 + Math.random() * 18,
            thick: 0.4 + Math.random() * 1.2,
            alpha: 0.25 + Math.random() * 0.55,
            gustPhase: Math.random() * Math.PI * 2,
            gustFreq: 0.008 + Math.random() * 0.025,
            gustAmp: 3 + Math.random() * 12,
          });
        }
        this._rainGustAngle = 0;
        this._rainLastGust = 0;
        this._rainGustTarget = 0;
        this._rainGustStrength = 0;
      }

      if (this.frames - this._rainLastGust > 60 + Math.random() * 180) {
        this._rainLastGust = this.frames;
        this._rainGustTarget = (Math.random() - 0.5) * 14;
        this._rainGustStrength = 0.4 + Math.random() * 1.4;
      }
      this._rainGustAngle +=
        (this._rainGustTarget - this._rainGustAngle) * 0.03;

      const gustAngleRad = (this._rainGustAngle * Math.PI) / 180;
      const globalDX =
        Math.sin(gustAngleRad) *
        this._rainGustStrength *
        this.rainIntensity *
        3;
      const activeCount = Math.floor(
        this.rainIntensity * this._rainDrops.length,
      );

      const layers = [
        {
          frac: 0.3,
          alphaScale: 0.4,
          speedScale: 0.55,
          lenScale: 0.55,
          thickScale: 0.6,
          color: "160,195,245",
        },
        {
          frac: 0.45,
          alphaScale: 0.85,
          speedScale: 1.0,
          lenScale: 1.0,
          thickScale: 1.0,
          color: "180,210,255",
        },
        {
          frac: 0.25,
          alphaScale: 1.3,
          speedScale: 1.6,
          lenScale: 1.5,
          thickScale: 1.6,
          color: "210,230,255",
        },
      ];

      let dropIdx = 0;
      for (const layer of layers) {
        const layerCount = Math.floor(activeCount * layer.frac);
        this.ctx.save();

        for (let i = 0; i < layerCount; i++, dropIdx++) {
          if (dropIdx >= this._rainDrops.length) break;
          const d = this._rainDrops[dropIdx];
          const turbX =
            Math.sin(this.frames * d.gustFreq + d.gustPhase) *
            d.gustAmp *
            this.rainIntensity;

          const dtF = 1;
          d.x += (d.speedX * layer.speedScale + globalDX + turbX * 0.08) * dtF;
          d.y +=
            d.speedY *
            layer.speedScale *
            dtF *
            (0.85 + this.rainIntensity * 0.3);

          if (d.y > h + 30) {
            d.y = -10;
            d.x = Math.random() * w;
          }
          if (d.x > w + 20) {
            d.x = -10;
          }
          if (d.x < -20) {
            d.x = w + 10;
          }

          const alpha = Math.min(
            1,
            d.alpha * layer.alphaScale * (0.5 + this.rainIntensity * 0.8),
          );
          const len = d.len * layer.lenScale * (0.7 + this.rainIntensity * 0.5);
          const thick = d.thick * layer.thickScale;

          const dx =
            (d.speedX * layer.speedScale + globalDX + turbX * 0.08) * 0.5;
          const dy = d.speedY * layer.speedScale;
          const mag = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = dx / mag;
          const ny = dy / mag;

          this.ctx.beginPath();
          this.ctx.strokeStyle = `rgba(${layer.color},${alpha.toFixed(2)})`;
          this.ctx.lineWidth = thick;
          this.ctx.moveTo(d.x, d.y);
          this.ctx.lineTo(d.x - nx * len, d.y - ny * len);
          this.ctx.stroke();

          if (d.y > h * 0.9 && Math.random() < 0.08 * this.rainIntensity) {
            this.ctx.beginPath();
            this.ctx.arc(d.x, d.y, 1 + Math.random() * 2, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(${layer.color},${(alpha * 0.5).toFixed(2)})`;
            this.ctx.fill();
          }
        }
        this.ctx.restore();
      }

      if (this.rainIntensity > 0.65) {
        const heavyCount = Math.floor((this.rainIntensity - 0.65) * 40);
        this.ctx.save();
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = `rgba(220, 235, 255, ${((this.rainIntensity - 0.65) * 0.6).toFixed(2)})`;
        this.ctx.beginPath();
        for (let i = 0; i < heavyCount; i++) {
          const hx = Math.random() * w;
          const hy = Math.random() * h;
          const hl = 22 + Math.random() * 20;
          const hax = gustAngleRad * 0.6 + (Math.random() - 0.5) * 0.3;
          this.ctx.moveTo(hx, hy);
          this.ctx.lineTo(
            hx + Math.sin(hax) * hl * 0.4,
            hy + Math.cos(hax) * hl,
          );
        }
        this.ctx.stroke();
        this.ctx.restore();
      }

      if (this.trackWetness > 0.55) {
        this.ctx.save();
        const mistAlpha = (this.trackWetness - 0.55) * 0.18;
        const mistGrd = this.ctx.createLinearGradient(0, h * 0.5, 0, h);
        mistGrd.addColorStop(0, `rgba(140,175,220,0)`);
        mistGrd.addColorStop(1, `rgba(140,175,220,${mistAlpha.toFixed(3)})`);
        this.ctx.fillStyle = mistGrd;
        this.ctx.fillRect(0, 0, w, h);
        this.ctx.restore();
      }
    }
  }
}

let F1Game = null;
window.addEventListener("load", () => {
  const cnd = document.getElementById("circuit-name-display");
  if (cnd) cnd.textContent = _activeTrack.name;

  if (window.speechSynthesis) window.speechSynthesis.getVoices();
  F1Game = new GameManager();
});
