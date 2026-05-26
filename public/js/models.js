class TrackGeometry {
    constructor() {
        this.trackPoints = []; this.trackLength = 0; this.trackSegLengths = [];
        this.trackCurvature = []; this.trackIdealLanes = [];
        this.buildTrack();
    }
    buildTrack() {
        const raw = _activeTrack.raw;
        const scaleY = _activeTrack.scaleY || 1.0;
        const scaledPts = raw.map(([nx, ny]) => [(nx - 0.5) * WORLD_SCALE, (ny - 0.5) * WORLD_SCALE * scaleY]);
        this.trackPoints = []; const n = scaledPts.length, segs = 35;
        for (let i = 0; i < n; i++) {
            const p0 = scaledPts[(i - 1 + n) % n], p1 = scaledPts[i], p2 = scaledPts[(i + 1) % n], p3 = scaledPts[(i + 2) % n];
            for (let t = 0; t < segs; t++) {
                const s = t / segs, s2 = s * s, s3 = s2 * s;
                const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3);
                const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3);
                this.trackPoints.push([x, y]);
            }
        }
        const tpLen = this.trackPoints.length;
        this.trackIdealLanes = new Array(tpLen).fill(0);

        for (let i = 0; i < tpLen; i++) {
            const p1 = this.trackPoints[i], p2 = this.trackPoints[(i + 1) % tpLen];
            const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); this.trackSegLengths.push(d); this.trackLength += d;
            const pPrev = this.trackPoints[(i - 5 + tpLen) % tpLen], pNext = this.trackPoints[(i + 5) % tpLen];
            const dx1 = p1[0] - pPrev[0], dy1 = p1[1] - pPrev[1], dx2 = pNext[0] - p1[0], dy2 = pNext[1] - p1[1];
            const cross = dx1 * dy2 - dy1 * dx2, den = (Math.hypot(dx1, dy1) + 0.01) * (Math.hypot(dx2, dy2) + 0.01);
            this.trackCurvature[i] = { val: Math.abs(cross) / den, sign: Math.sign(cross) };
            this.trackIdealLanes[i] = this.trackCurvature[i].val > 0.005 ? -this.trackCurvature[i].sign * Math.min(0.85, this.trackCurvature[i].val * 26) : 0;
        }
        for (let pass = 0; pass < 4; pass++) {
            let nextL = [...this.trackIdealLanes];
            for (let i = 0; i < tpLen; i++) { nextL[i] = (this.trackIdealLanes[(i - 1 + tpLen) % tpLen] + this.trackIdealLanes[i] + this.trackIdealLanes[(i + 1) % tpLen]) / 3; }
            this.trackIdealLanes = nextL;
        }
    }
    getPointAt(trackPos) {
        let acc = 0; const targetDist = (trackPos % 1.0) * this.trackLength;
        for (let i = 0; i < this.trackPoints.length; i++) {
            if (acc + this.trackSegLengths[i] >= targetDist || i === this.trackPoints.length - 1) {
                const frac = this.trackSegLengths[i] === 0 ? 0 : (targetDist - acc) / this.trackSegLengths[i];
                const p1 = this.trackPoints[i], p2 = this.trackPoints[(i + 1) % this.trackPoints.length];
                const x = p1[0] + (p2[0] - p1[0]) * frac, y = p1[1] + (p2[1] - p1[1]) * frac;
                const tL = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + 0.001;
                return { x, y, tangX: (p2[0] - p1[0]) / tL, tangY: (p2[1] - p1[1]) / tL, nx: -(p2[1] - p1[1]) / tL, ny: (p2[0] - p1[0]) / tL, idx: i };
            } acc += this.trackSegLengths[i];
        } return null;
    }
}

class SafetyCarModel {
    constructor() {
        this.isSC = true; this.active = false;
        this.dist = 0; this.speed = 0; this.laneOffset = 0.0;
        this.x = 0; this.y = 0; this.tangAngle = 0; this.displayKmh = 0;
        this.inPitPhase = 0; this.retired = false;
        this.bodyPitch = 0; this.bodyRoll = 0; this.steerAngle = 0;
    }
}

class CarModel {
    constructor(idx) {
        this.id = idx; const dat = DRIVER_DB[idx], tm = F1_TEAMS[dat.t];
        this.name = dat.n; this.color = tm.c; this.accent = tm.h; this.teamName = tm.name;
        this.skill = dat.s; this.aggression = dat.a;
        this.driverLineVariance = (Math.random() - 0.5) * 0.15 * (1.0 - this.skill);

        this.gridSlotIdx = idx;
        this.gridTargetDist = 0.99 - (idx * 0.015);
        this.dist = 0.88 + (idx * 0.004);

        this.targetLane = 2.8;
        this.laneOffset = 2.8;
        this.laneVelocity = 0;
        this.steerAngle = 0;
        this.bodyPitch = 0;
        this.bodyRoll = 0;
        this.rideHeight = 2.0;

        this.speed = 0; this.displayKmh = 0;
        this.targetVelocitySmoothed = MAX_BASE_SPEED * 0.3;
        this.aiUpdateTimer = 0; this.lastIntents = null;

        this.gear = 1; this.brakeActive = false; this.throttlePercent = 0;
        this.brakeGlow = 0; this.shiftTimer = 0; this.shiftDelay = 6;
        this.rpm = 4000;

        this.reactionTimer = 0;
        this.launchState = 'WAIT';
        this.isBottomingOut = false;

        this.ersBattery = 100.0;
        this.ersMode = 'HARV';
        this.paceMode = 'STANDARD';

        this.tyreType = 'SOFT';
        this.tyreTemps = [70, 70, 70, 70];
        this.strategyTargetLap = 100; this.lastPitLap = -1;

        this.x = 0; this.y = 0; this.tangAngle = 0;
        this.topSpeedBonus = MAX_BASE_SPEED * (0.80 + dat.s * 0.20);
        this.lapStartTime = 0; this.currentSector = 0; this.sectorTimes = [0, 0, 0]; this.bestLap = Infinity;

        this.qPhase = 'WAIT';
        this.pitTimer = idx * 10 + Math.floor(Math.random() * 10);

        this.tyreWear = 0; this.pitStops = 0; this.wantsToPit = false; this.targetPitTyre = null;
        this.inPitPhase = 2; this.pitBoxFrac = this.dist;
        this.pitSpeedPenaltyIssued = false; this.pitLinePenaltyIssued = false;

        this.retired = false; this.isSpinning = false; this.spinTimer = 0;
        this.hasWingDamage = false; this.hasPuncture = false;
        this.smokeColor = null; this.dnfType = "";

        this.uiPos = idx + 1; this.timePenalty = 0; this.drsActive = false;

        this.fuelLoad = 110.0;
        this.fuelBurnRate = 0;
        this.isLiftCoasting = false;
        this.trackLimitsWarnings = 0;
        this.trackLimitsLastFrac = -1;
        this.lapDeleted = false;
        this.lastLapDeleted = false;

        this.slipAngle = 0; this.smoothedSlipAngle = 0; this.yawRate = 0;
        this.lateralG = 0; this.longitudinalG = 0;
        this.wheelspin = 0; this.lockupAmount = 0;
        this.tyrePressure = [23.5 + Math.random() * 0.5, 23.5 + Math.random() * 0.5, 21.5 + Math.random() * 0.5, 21.5 + Math.random() * 0.5];
        this.flatSpots = [0, 0, 0, 0];
        this.graining = 0; this.blistering = 0;
        this.downforce = 0; this.porpoisingPhase = 0; this.isPorpoising = false;
        this.wingDamageLevel = 0; this.hasBrokenWing = false;
        this.bumpShake = 0; this.driveThrough = false;
        this.driveThrough5s = 0; this.stopGoPenalty = false;
        this.curbImpact = 0; this.collisionShake = 0;
        this.fakeMove = false; this.fakeMoveTimer = 0;
        this.switchback = false; this.championship = 0;
        this.raceStarted = false;

        this.defenseState = {
            mode: 'NONE',
            blockedLane: 0,
            holdTimer: 0,
            threatId: -1,
            committed: false,
            reactTimer: 0,
        };

        this.telHistory = { thr: [], brk: [], rpm: [], spd: [] };

        this.emotion = 'neutral';
        this.emotionTimer = 0;
        this.turboSpool = 0;
        this.engineBrakeForce = 0;
        this.cascadeType = null;
        this.surfaceType = 'tarmac';
        this.trackEvolutionGrip = 1.0;
        this.pacejkaGrip = 1.0;

        this.finishedRace = false;
        this.finishPos = 0;
        this.finishTime = 0;
    }
    get fraction() { return (this.dist % 1.0 + 1.0) % 1.0 }
    get currentLap() { return Math.max(0, Math.floor(this.dist) + 1) }
}