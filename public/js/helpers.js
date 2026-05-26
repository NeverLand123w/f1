let trackRubberMap = null;
let trackMarbleMap = null;
let driverOffenseHistory = {};

function fmtTime(t) { return (!t || t === Infinity || t < 0.1) ? '—.———' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}` }

function getTempColor(t, optT, rng) {
    if (t < optT - rng * 1.5) return 'var(--cold)';
    if (t < optT - rng * 0.6) return '#00a3ff';
    if (t > optT + rng * 1.6) return 'var(--red)';
    if (t > optT + rng * 0.8) return 'var(--orange)';
    return 'var(--green)';
}

function getTyreGrip(wear, temp, tyreType) {
    const tCfg = TYRES[tyreType] || TYRES['SOFT'];
    const optT = tCfg.optTemp;

    let baseGrip = PACEJKA.D;
    let tempDelta = Math.abs(temp - optT);
    let tempMod = Math.max(0.4, 1.0 - tempDelta * 0.008);
    let wearMod = 1.0 - Math.pow(wear / 100, 2.5) * 0.45;

    return Math.max(0.2, baseGrip * tempMod * wearMod);
}

function computeGripConfidence(car, trackWetness) {
    const surfaceTempDrop = trackWetness * 14.0;
    const surfaceTemp = (35 - surfaceTempDrop);
    const avgTyreTemp = (car.tyreTemps[0] + car.tyreTemps[1] + car.tyreTemps[2] + car.tyreTemps[3]) / 4;
    const tCfg = TYRES[car.tyreType] || TYRES['SOFT'];
    const optTemp = tCfg.optTemp;

    const tempDeficit = Math.max(0, optTemp - avgTyreTemp);
    const tempGripPenalty = Math.min(1.0, tempDeficit / 40.0);

    const pacejkaGrip = car.pacejkaGrip || 1.0;
    const wetOffset = Math.abs(trackWetness - (tCfg.idealWet || 0.0));
    const compoundMismatch = Math.min(1.0, wetOffset * (tCfg.wetPen || 2.0) * 0.35);
    const wearFear = Math.pow(car.tyreWear / 100, 2.2) * 0.5;

    return Math.max(0, pacejkaGrip * (1 - tempGripPenalty) * (1 - compoundMismatch) * (1 - wearFear));
}

function updateAIEmotion(car, raceContext) {
    if (!car.emotion) car.emotion = 'neutral';
    if (!car.emotionTimer) car.emotionTimer = 0;
    car.emotionTimer--;
    if (car.emotionTimer > 0) return;

    const gripConf = computeGripConfidence(car, raceContext.trackWetness || 0);

    if (car.isSpinning || car.hasPuncture || car.collisionShake > 5 || gripConf < 0.35) {
        car.emotion = 'panic'; car.emotionTimer = 180 + (1 - gripConf) * 120;
    } else if ((car.uiPos > 12 && car.tyreWear > 55) || (gripConf < 0.55 && car.uiPos > 8)) {
        car.emotion = 'frustration'; car.emotionTimer = 160;
    } else if (car.uiPos <= 3 && gripConf > 0.75 && car.speed > raceContext.avgSpeed * 1.01) {
        car.emotion = 'confidence'; car.emotionTimer = 250;
    } else if (car.aggression > 0.90 && car.overtakeState && car.overtakeState.committed && gripConf > 0.6) {
        car.emotion = 'aggro'; car.emotionTimer = 80 + gripConf * 60;
    } else {
        car.emotion = 'neutral'; car.emotionTimer = 280 + Math.random() * 200;
    }
    car.gripConfidence = gripConf;
}

function emotionToModifiers(emotion, gripConf) {
    const gc = (gripConf !== undefined) ? gripConf : 0.7;
    switch (emotion) {
        case 'panic': return { speedMult: 0.94 - (1 - gc) * 0.04, aggrBonus: -0.08, brakeMod: 1.18 + (1 - gc) * 0.12, overtakeMult: 0.5 };
        case 'frustration': return { speedMult: 0.97, aggrBonus: +0.07, brakeMod: 0.93, overtakeMult: 1.2 };
        case 'confidence': return { speedMult: 1.01 + gc * 0.01, aggrBonus: +0.03, brakeMod: 1.00, overtakeMult: 1.3 };
        case 'aggro': return { speedMult: 1.02 + gc * 0.02, aggrBonus: +0.10, brakeMod: 0.88, overtakeMult: 1.6 };
        default: return { speedMult: 1.00, aggrBonus: 0.00, brakeMod: 1.00, overtakeMult: 1.0 };
    }
}

function getTrackEvolutionGrip(car, trackData, trackRubber) {
    if (!trackRubberMap || !trackMarbleMap) return 1.0;
    const tpLen = trackData.trackPoints.length;
    const idx = Math.floor(car.fraction * tpLen) % tpLen;
    const idealLane = trackData.trackIdealLanes[idx];
    const laneDeviation = Math.abs(car.laneOffset - idealLane);

    if (laneDeviation < 0.35) {
        let rubberGrip = 1.0 + trackRubberMap[idx] * 0.12;
        return rubberGrip;
    } else {
        let marblePenalty = trackMarbleMap[idx] * Math.min(1.0, (laneDeviation - 0.35) / 0.4);
        return 1.0 - marblePenalty * 0.22;
    }
}

function computeTorqueOutput(car, throttle, rpm, isAccel) {
    if (!car.turboSpool) car.turboSpool = 0;
    const turboTarget = throttle > 0.3 ? Math.min(1.0, (rpm - 4000) / 8000) : 0;
    car.turboSpool += (turboTarget - car.turboSpool) * 0.03;
    const rpmNorm = Math.max(0, Math.min(1, (rpm - 4000) / 8000));
    const torqueCurve = rpmNorm < 0.3 ? rpmNorm / 0.3 * 0.7 + car.turboSpool * 0.3
        : rpmNorm < 0.8 ? 1.0 : 1.0 - (rpmNorm - 0.8) / 0.2 * 0.25;
    const engineBrake = (!isAccel && throttle < 0.1) ? -0.35 * (1.0 - rpmNorm * 0.5) : 0;
    return Math.max(-0.5, torqueCurve + engineBrake);
}

function getSurfaceGrip(car) {
    if (car.inPitPhase > 0) return { type: 'tarmac', grip: 1.0, dragMult: 1.0 };
    const absLane = Math.abs(car.laneOffset);

    if (absLane > 1.35) return { type: 'gravel', grip: 0.25, dragMult: 3.5 };
    else if (absLane > 1.20) return { type: 'grass', grip: 0.65, dragMult: 1.5 };

    return { type: 'tarmac', grip: 1.0, dragMult: 1.0 };
}

function recordOffense(driverName, type) {
    if (!driverOffenseHistory[driverName]) driverOffenseHistory[driverName] = {};
    driverOffenseHistory[driverName][type] = (driverOffenseHistory[driverName][type] || 0) + 1;
}
function getOffenseCount(driverName, type) {
    return (driverOffenseHistory[driverName] || {})[type] || 0;
}
function curvSign_helper(car) {
    if (!F1Game || !F1Game.track) return 1;
    let pInfo = F1Game.track.getPointAt(car.fraction);
    if (!pInfo) return 1; return F1Game.track.trackCurvature[pInfo.idx]?.sign || 1;
}