class AIController {
    static evaluate(car, allCars, trackData, raceState, envObj) {
        if (car.retired || raceState === 'GRID' || car.qPhase === 'DONE') {
            return { tVel: 0, tLane: car.targetLane, wGrip: 1.0, dirtyAir: false, wakeForce: 0, launchAccel: 1.0 };
        }

        if (raceState === 'FORMATION') {
            let dtg = car.gridTargetDist - car.fraction;
            if (dtg < 0) dtg += 1.0;
            let laneTarget = (car.gridSlotIdx % 2 === 0) ? -0.4 : 0.4;
            if (dtg > 0.15) {
                return { tVel: MAX_BASE_SPEED * 0.35, tLane: Math.sin(F1Game.frames * 0.1 + car.id) * 0.4, wGrip: 1.0, dirtyAir: false, wakeForce: 0, launchAccel: 1.0 };
            } else if (dtg > 0.015) {
                return { tVel: Math.min(MAX_BASE_SPEED * 0.25, dtg * 0.08), tLane: laneTarget, wGrip: 1.0, dirtyAir: false, wakeForce: 0, launchAccel: 1.0 };
            } else {
                car.launchState = 'PARKED';
                return { tVel: 0, tLane: laneTarget, wGrip: 1.0, dirtyAir: false, wakeForce: 0, launchAccel: 1.0 };
            }
        }

        if (raceState === 'GRID_WAIT') {
            if (Math.random() < 0.00005 * car.aggression) {
                car.launchState = 'JUMPED'; return { tVel: MAX_BASE_SPEED * 0.4, tLane: car.laneOffset, wGrip: 1.0, dirtyAir: false, wakeForce: 0, launchAccel: 1.0 };
            }
            return { tVel: 0, tLane: car.laneOffset, wGrip: 1.0, dirtyAir: false, wakeForce: 0, launchAccel: 1.0 };
        }

        let launchBoost = 1.0;
        if (raceState === 'GREEN' && car.launchState !== 'WAIT' && car.launchState !== 'PARKED') {
            if (car.reactionTimer > 0) return { tVel: 0, tLane: car.laneOffset, wGrip: 1.0, dirtyAir: false, wakeForce: 0, launchAccel: 1.0 };
            if (car.launchState === 'PERFECT') launchBoost = 1.6;
            else if (car.launchState === 'BOGGED') launchBoost = 0.35;
            if (car.displayKmh > 180 && car.launchState !== 'NORMAL') car.launchState = 'NORMAL';
        }

        let isOutlap = false;
        if (raceState === 'GREEN') {
            isOutlap = (car.currentLap === car.lastPitLap && car.dist > 0.05 && car.inPitPhase === 0);
            car.paceMode = isOutlap ? 'PUSH' : 'STANDARD';
        } else if (raceState === 'QUALIFYING') {
            if (car.qPhase === 'OUT_LAP') car.paceMode = 'SAVE';
            else if (car.qPhase === 'HOT_LAP') car.paceMode = 'PUSH';
            else if (car.qPhase === 'IN_LAP') { car.paceMode = 'COOLDOWN'; car.wantsToPit = true; }
        }

        if (car.finishedRace) { car.paceMode = 'COOLDOWN'; car.wantsToPit = true; }

        const trackWetness = envObj?.wet || 0; const trackRubber = envObj?.rubber || 0;
        const frac = car.fraction, pInfo = trackData.getPointAt(frac);
        if (!pInfo) return { tVel: car.speed, tLane: car.targetLane, wGrip: 1.0, dirtyAir: false, wakeForce: 0, launchAccel: 1.0 };

        const nextP = trackData.getPointAt((frac + 0.015) % 1.0);
        const cvAhead = nextP ? trackData.trackCurvature[nextP.idx].val : 0;
        let idealLane = trackData.trackIdealLanes[pInfo.idx] + car.driverLineVariance;

        const tCfg = TYRES[car.tyreType] || TYRES['SOFT'];
        let avgT = (car.tyreTemps[0] + car.tyreTemps[1] + car.tyreTemps[2] + car.tyreTemps[3]) / 4.0;
        let tDiff = Math.abs(avgT - tCfg.optTemp);
        let tempGripMod = Math.max(0.65, 1.0 - Math.pow(tDiff / (tCfg.tempRange * 1.5), 2));

        let tyreCliffMod = Math.max(0.35, 1.0 - Math.pow(car.tyreWear / 100, 2.5));
        let damagePaceMod = car.hasWingDamage ? 0.70 : 1.0; if (car.hasPuncture) damagePaceMod = 0.25;

        let wetOffset = Math.abs(trackWetness - (tCfg.idealWet || 0));
        let envGrip = Math.max(0.55, 1.0 - (wetOffset * (tCfg.wetPen || 2.2) * 0.50));

        let distToIdeal = Math.abs(car.laneOffset - idealLane);
        if (trackWetness < 0.1 && (raceState === 'GREEN' || raceState === 'QUALIFYING')) {
            if (distToIdeal < 0.25) envGrip *= 1.0 + (trackRubber * 0.05);
            else if (distToIdeal > 0.5) envGrip *= 1.0 - (trackRubber * 0.04);
        }

        let baseLimit = car.topSpeedBonus * damagePaceMod * tempGripMod * envGrip * tyreCliffMod * (1 + (tCfg.gripBonus || 0));

        if (car.paceMode === 'PUSH') baseLimit *= 1.02;
        else if (car.paceMode === 'SAVE') baseLimit *= 0.96;
        else if (car.paceMode === 'COOLDOWN') baseLimit *= 0.65;

        let rawTargetVelocity = Math.max(PIT_SPEED_LIMIT * 0.45, Math.exp(-cvAhead * 20) * baseLimit);
        let overtakingAllowed = true;

        if (raceState === 'VSC') {
            rawTargetVelocity = Math.min(rawTargetVelocity, VSC_PACE_SPEED); overtakingAllowed = false;
        } else if (raceState === 'SC') {
            overtakingAllowed = false;
            if (car.inPitPhase === 0) {
                const activeSCCars = allCars.filter(c => !c.retired && c.inPitPhase === 0 && !c.isSC);
                const scCarObj = allCars.find(c => c.isSC);
                let targetAhead = (car.uiPos === 1) ? scCarObj : activeSCCars.find(c => c.uiPos === car.uiPos - 1);

                if (targetAhead) {
                    let dDist = (targetAhead.dist - car.dist) % 1.0; if (dDist < 0) dDist += 1.0;
                    let error = 0.025 - dDist;
                    rawTargetVelocity = Math.min(baseLimit * 0.85, targetAhead.speed - error * 0.15);
                    rawTargetVelocity = Math.max(SC_PACE_SPEED * 0.55, rawTargetVelocity);
                } else {
                    rawTargetVelocity = Math.min(rawTargetVelocity, SC_PACE_SPEED * 1.1);
                }
            }
        } else if (car.finishedRace || raceState === 'FINISHED') {
            rawTargetVelocity = Math.min(rawTargetVelocity, baseLimit * 0.40);
            idealLane = car.laneOffset > 0 ? 0.8 : -0.8; overtakingAllowed = false;
        }

        if (car.surfaceType !== 'tarmac') {
            idealLane = car.laneOffset > 0 ? 0.7 : -0.7;
            rawTargetVelocity = Math.max(MAX_BASE_SPEED * 0.25, rawTargetVelocity);
            overtakingAllowed = false;
            if (car.overtakeState) car.overtakeState.committed = false;
        }

        if (raceState !== 'QUALIFYING' && raceState !== 'FINISHED' && raceState !== 'GRID') {
            let optTyre = null;
            if (trackWetness >= 0.65 && car.tyreType !== 'WET') optTyre = 'WET';
            else if (trackWetness >= 0.15 && trackWetness < 0.65 && car.tyreType !== 'INTER') optTyre = 'INTER';
            else if (trackWetness < 0.05 && (car.tyreType === 'INTER' || car.tyreType === 'WET')) optTyre = 'SOFT';

            if ((raceState === 'SC' || raceState === 'VSC') && car.tyreWear > 50 && car.inPitPhase === 0 && !car.wantsToPit && trackWetness < 0.05 && car.pitStops < 3) {
                car.wantsToPit = true; car.targetPitTyre = car.tyreType === 'SOFT' ? 'MEDIUM' : 'SOFT';
                F1Game.broadcast.triggerEvent({ type: 'sc_pit', car: car });
            }
            if (optTyre !== null && !car.wantsToPit && car.inPitPhase === 0 && Math.random() < 0.015) { car.wantsToPit = true; car.targetPitTyre = optTyre; }

            const lapsRemaining = TOTAL_LAPS - car.currentLap;
            const isNearFinish = lapsRemaining <= 0 || (lapsRemaining === 1 && car.fraction > 0.7);
            const isLastTwoLaps = lapsRemaining <= 2;

            if (car.hasWingDamage || car.hasPuncture || car.tyreWear > 95) {
                if (!isNearFinish) {
                    car.wantsToPit = true;
                    if (!car.targetPitTyre) { if (trackWetness >= 0.65) car.targetPitTyre = 'WET'; else if (trackWetness >= 0.15) car.targetPitTyre = 'INTER'; }
                } else if (car.hasPuncture && car.tyreWear >= 100) {
                    car.wantsToPit = false;
                }
            } else if (car.hasWingDamage && !isLastTwoLaps) {
                car.wantsToPit = true;
                if (!car.targetPitTyre) { if (trackWetness >= 0.65) car.targetPitTyre = 'WET'; else if (trackWetness >= 0.15) car.targetPitTyre = 'INTER'; }
            } else if (car.tyreWear > 85 && !isLastTwoLaps) {
                car.wantsToPit = true;
                if (!car.targetPitTyre) { if (trackWetness >= 0.65) car.targetPitTyre = 'WET'; else if (trackWetness >= 0.15) car.targetPitTyre = 'INTER'; }
            }
            if (car.currentLap >= car.strategyTargetLap && car.tyreWear > 50 && car.inPitPhase === 0 && trackWetness < 0.1 && car.pitStops < 3 && !car.wantsToPit && !isLastTwoLaps) {
                car.wantsToPit = true;
            }
            if (isLastTwoLaps && car.inPitPhase === 0 && !car.hasPuncture && car.tyreWear < 98) {
                car.wantsToPit = false;
            }
        }

        if (car.wantsToPit && frac > 0.835 && frac < 0.845) { car.inPitPhase = 1; }

        if (car.inPitPhase === 1) {
            idealLane = 2.8; overtakingAllowed = false; car.paceMode = 'STANDARD';
            if (car.overtakeState) car.overtakeState.committed = false;
            car.fakeMove = false; car.switchback = false;

            let distToBox = car.pitBoxFrac - frac; if (distToBox < 0) distToBox += 1.0;
            if (distToBox < 0.012) idealLane = 3.8;

            if (car.displayKmh > 80 && frac > 0.85 && car.laneOffset > 1.5) rawTargetVelocity = 0;
            else rawTargetVelocity = PIT_SPEED_LIMIT;

            if (distToBox < 0.003 || distToBox > 0.99) {
                car.inPitPhase = 2; car.speed = 0; car.pitTimer = (car.hasWingDamage || car.hasPuncture) ? 40 : 15;
                if (raceState !== 'QUALIFYING' && !car.finishedRace) F1Game.broadcast.triggerEvent({ type: 'pit', car: car });
            }
        }
        else if (car.inPitPhase === 2) {
            car.pitTimer--; rawTargetVelocity = 0; idealLane = 3.8; overtakingAllowed = false;
            if (car.overtakeState) car.overtakeState.committed = false;
            car.fakeMove = false; car.switchback = false;

            if (raceState === 'QUALIFYING' && car.qPhase === 'IN_LAP') { car.speed = 0; car.qPhase = 'DONE'; }
            else if (car.finishedRace) { car.speed = 0; car.qPhase = 'DONE'; }
            else if (car.pitTimer <= 0 && car.qPhase !== 'DONE') {
                car.inPitPhase = 3; car.tyreWear = 0; car.pitStops++; car.wantsToPit = false; car.hasWingDamage = false; car.hasPuncture = false;
                if (raceState !== 'QUALIFYING') {
                    car.tyreType = car.targetPitTyre || (car.tyreType === 'SOFT' ? 'MEDIUM' : 'HARD'); car.targetPitTyre = null;
                    car.lastPitLap = car.currentLap; car.strategyTargetLap = car.currentLap + (TYRES[car.tyreType] || TYRES['SOFT']).dur;
                }
                car.tyreTemps = [75, 75, 75, 75];
            }
        }
        else if (car.inPitPhase === 3) {
            idealLane = 2.8; rawTargetVelocity = PIT_SPEED_LIMIT; overtakingAllowed = false;
            let distFromBox = frac - car.pitBoxFrac; if (distFromBox < 0) distFromBox += 1.0;
            if (distFromBox < 0.01) idealLane = 3.8;

            if (frac > 0.035 && frac < 0.2) car.inPitPhase = 4;
            if (raceState === 'QUALIFYING' && car.qPhase === 'WAIT') car.qPhase = 'OUT_LAP';
        }
        else if (car.inPitPhase === 4) {
            if (frac < 0.06) idealLane = 1.8; else { idealLane = 0.4; if (Math.abs(car.laneOffset - 0.4) < 0.6) car.inPitPhase = 0; }
        }

        let slipstreaming = false, isAttacking = false, dirtyAirIntensity = 0;
        let distAhead = 1.0, distBehind = 1.0, trailingCar = null, leadingCar = null;

        let isSideBySide = false;
        let adjacentCar = null;
        if (car.inPitPhase === 0 && raceState !== 'GRID') {
            allCars.forEach(o => {
                if (o === car || o.retired || o.inPitPhase > 0) return;
                let d = (o.dist - car.dist) % 1.0;
                if (d < -0.5) d += 1.0; else if (d > 0.5) d -= 1.0;

                if (Math.abs(d) < CAR_SPACE_FRAC * 2.8) {
                    isSideBySide = true;
                    if (Math.abs(car.laneOffset - o.laneOffset) < 1.4) {
                        adjacentCar = o;
                    }
                }
            });
        }

        if (!car.atkState) car.atkState = { phase: 'NONE', side: 0, targetLane: 0, timer: 0, switchCount: 0, blockedBy: null };
        const atk = car.atkState;
        if (atk.timer > 0) atk.timer--;

        if (!car.defState) car.defState = { phase: 'NONE', moveMade: false, moveTimer: 0, holdLane: null, threatId: -1, speedBoostTimer: 0 };
        const def = car.defState;
        if (def.moveTimer > 0) def.moveTimer--;
        if (def.speedBoostTimer > 0) def.speedBoostTimer--;

        if (car.inPitPhase === 0 && raceState !== 'GRID') {
            allCars.forEach(o => {
                if (o === car || o.retired) return;
                let diffDist = (o.dist - car.dist) % 1.0; if (diffDist < -0.5) diffDist += 1.0; else if (diffDist > 0.5) diffDist -= 1.0;

                if (o.isSpinning || o.hasPuncture) {
                    if (diffDist > 0 && diffDist < 0.08) { rawTargetVelocity = Math.min(rawTargetVelocity, MAX_BASE_SPEED * 0.45); overtakingAllowed = false; idealLane += (o.laneOffset > 0 ? -0.9 : 0.9); }
                } else if (o.isSC) {
                    if (diffDist > 0 && diffDist < 0.08) { rawTargetVelocity = Math.min(rawTargetVelocity, o.speed * Math.max(0.85, diffDist / 0.05)); idealLane = 0; }
                } else {
                    if (diffDist > 0 && diffDist < distAhead) { distAhead = diffDist; leadingCar = o; }
                    if (diffDist < 0 && -diffDist < distBehind) { distBehind = -diffDist; trailingCar = o; }

                    if ((o.inPitPhase > 0) === (car.inPitPhase > 0) && diffDist > 0 && diffDist < 0.10 && !car.isSpinning) {
                        const lDiff = Math.abs(o.laneOffset - car.laneOffset);
                        if (lDiff < 0.9) slipstreaming = true;
                    }
                }
            });

            if (overtakingAllowed && leadingCar && !leadingCar.retired && leadingCar.inPitPhase === 0) {
                const lc = leadingCar;
                const distToFront = distAhead;
                const lDiff = Math.abs(lc.laneOffset - car.laneOffset);
                const speedEdge = car.drsActive ? 0.85 : (trackWetness > 0.2 ? 0.96 : 0.91);
                const canAttack = car.speed >= lc.speed * speedEdge && trackWetness < 0.5 && (car.gripConfidence === undefined || car.gripConfidence > 0.30);
                const inAttackZone = distToFront > 0 && distToFront < CAR_SPACE_FRAC * 9.0;
                const sideBySide = distToFront < CAR_SPACE_FRAC * 2.5 && lDiff > 0.50;

                if (atk.phase === 'NONE' && canAttack && inAttackZone && lDiff < 1.0 && atk.timer === 0) {
                    atk.phase = 'SLIPSTREAM';
                    atk.targetLane = lc.laneOffset;
                    atk.switchCount = 0;
                    atk.blockedBy = null;
                }

                if (atk.phase === 'SLIPSTREAM') {
                    isAttacking = true;
                    idealLane = lc.laneOffset;
                    rawTargetVelocity *= 1.06;

                    if (distToFront < CAR_SPACE_FRAC * 3.5) {
                        atk.phase = 'APPROACH';
                        const leftRoom = lc.laneOffset - (-1.15);
                        const rightRoom = 1.15 - lc.laneOffset;
                        atk.side = (leftRoom > rightRoom) ? -1 : 1;
                        atk.targetLane = Math.max(-1.10, Math.min(1.10, lc.laneOffset + atk.side * 1.15));
                    }
                    if (!inAttackZone) { atk.phase = 'NONE'; atk.timer = 30; }
                }

                if (atk.phase === 'APPROACH') {
                    isAttacking = true;
                    idealLane = atk.targetLane;

                    if (distToFront > CAR_SPACE_FRAC * 1.5) {
                        rawTargetVelocity *= 1.04;
                    } else {
                        rawTargetVelocity = Math.min(rawTargetVelocity, lc.speed * 1.01);
                    }

                    const defenderBlockingUs = Math.abs(lc.laneOffset - atk.targetLane) < 0.5;
                    if (defenderBlockingUs && distToFront > CAR_SPACE_FRAC * 1.2) {
                        if (atk.switchCount === 0) {
                            atk.side = -atk.side;
                            atk.targetLane = Math.max(-1.10, Math.min(1.10, lc.laneOffset + atk.side * 1.15));
                            atk.switchCount = 1;
                            idealLane = atk.targetLane;
                        } else {
                            atk.phase = 'ABORT';
                            atk.timer = 80 + Math.floor(Math.random() * 40);
                        }
                    }

                    if (sideBySide) { atk.phase = 'ALONGSIDE'; }
                }

                if (atk.phase === 'ALONGSIDE') {
                    isAttacking = true;
                    idealLane = atk.targetLane;
                    if (atk.side === 1) idealLane -= 0.15; else idealLane += 0.15;

                    rawTargetVelocity = Math.max(rawTargetVelocity, lc.speed * 1.015);
                    if (distToFront > CAR_SPACE_FRAC * 3.5 || distAhead <= 0) {
                        atk.phase = 'COMPLETE'; atk.timer = 50;
                    }
                }

                if (atk.phase === 'COMPLETE') {
                    if (atk.timer === 0) { atk.phase = 'NONE'; atk.targetLane = 0; }
                }

                if (atk.phase === 'ABORT') {
                    const safeGap = CAR_SPACE_FRAC * 3.5;
                    if (distToFront < safeGap) rawTargetVelocity = Math.min(rawTargetVelocity, lc.speed * 0.90);
                    if (atk.timer === 0) { atk.phase = 'NONE'; }
                }
            } else {
                if (atk.phase !== 'NONE' && atk.phase !== 'ABORT') { atk.phase = 'NONE'; atk.timer = 30; }
                if (leadingCar && distAhead > 0 && distAhead < CAR_SPACE_FRAC * 4.0 && leadingCar.inPitPhase === 0) {
                    rawTargetVelocity = Math.min(rawTargetVelocity, leadingCar.speed * (0.87 + (distAhead / (CAR_SPACE_FRAC * 4.0)) * 0.13));
                }
            }

            car.overtakeState = car.overtakeState || { committed: false, targetLane: 0, timer: 0, fallback: false };
            car.overtakeState.committed = (atk.phase === 'APPROACH' || atk.phase === 'ALONGSIDE');
            car.overtakeState.targetLane = atk.targetLane;

            if (!isAttacking && raceState === 'GREEN' && car.inPitPhase === 0) {
                let threat = null, threatDist = Infinity, threatFromSameLane = false;

                allCars.forEach(o => {
                    if (o === car || o.retired || o.inPitPhase > 0) return;
                    let d = (car.dist - o.dist) % 1.0; if (d < 0) d += 1.0; if (d > 0.5) d = 1.0 - d;
                    if (d < 0 || d > 0.14) return;

                    const isClosing = o.speed >= car.speed * 0.96;
                    const isActive = o.atkState && (o.atkState.phase === 'APPROACH' || o.atkState.phase === 'SLIPSTREAM');

                    if ((isActive || isClosing) && d < threatDist) {
                        threat = o; threatDist = d;
                        threatFromSameLane = Math.abs(o.laneOffset - car.laneOffset) < 0.55;
                    }
                });

                if (threat) {
                    const myLane = car.laneOffset;
                    const threatLane = threat.laneOffset;
                    const atkTargetLane = (threat.atkState && threat.atkState.phase !== 'NONE') ? threat.atkState.targetLane : threatLane;
                    const isSideBySideWithThreat = threatDist < CAR_SPACE_FRAC * 2.5 && Math.abs(threatLane - myLane) > 0.45;
                    const inBrakingZone = trackData.trackCurvature[pInfo.idx].val > 0.005;
                    const threatPullingOut = threat.atkState && threat.atkState.phase === 'APPROACH';

                    if (isSideBySideWithThreat) {
                        def.phase = 'ALONGSIDE';
                        const minGap = 1.10;
                        if (threatLane > myLane) idealLane = Math.min(idealLane, threatLane - minGap);
                        else idealLane = Math.max(idealLane, threatLane + minGap);

                        rawTargetVelocity = Math.max(rawTargetVelocity, car.speed * 1.008);
                        def.moveMade = false;
                    }
                    else if (threatPullingOut && !def.moveMade) {
                        if (!inBrakingZone) {
                            def.phase = 'SINGLE_MOVE';
                            const coverDir = atkTargetLane > myLane ? 1 : -1;
                            def.holdLane = Math.max(-1.10, Math.min(1.10, myLane + coverDir * 0.90));
                            def.moveMade = true;
                            def.moveTimer = 150;
                            def.threatId = threat.id;
                        }
                    }
                    else if (threatFromSameLane && def.phase === 'NONE') {
                        def.phase = 'HOLD_SAME_LANE';
                        def.holdLane = myLane;
                        def.moveMade = false;
                    }

                    if ((def.phase === 'SINGLE_MOVE' || def.phase === 'HOLD_SAME_LANE') && def.phase !== 'ALONGSIDE') {
                        if (!inBrakingZone) idealLane = def.holdLane;
                    }

                    if (threat.speed > car.speed * 0.99) {
                        rawTargetVelocity = Math.max(rawTargetVelocity, car.speed * 1.018);
                        if (car.ersBattery > 5) car.ersMode = 'DEFEND';
                    }
                } else {
                    if (def.phase !== 'NONE' && def.moveTimer === 0) {
                        def.phase = 'NONE'; def.moveMade = false; def.holdLane = null; def.threatId = -1;
                    }
                }
            } else {
                def.phase = 'NONE'; def.moveMade = false; def.holdLane = null; def.moveTimer = 0;
            }

            if (car.aggression > 0.92 && !car.fakeMove && leadingCar && distAhead < 0.04 && isAttacking && Math.random() < 0.003) {
                car.fakeMove = true; car.fakeMoveTimer = 35 + Math.random() * 20;
            }
        }

        let isDirtyAir = false;
        if (car.inPitPhase === 0 && raceState === 'GREEN' && trackWetness < 0.1 && car.pitStops < 3) {
            let inPitWindow = Math.abs(car.strategyTargetLap - car.currentLap) <= 1;
            if (inPitWindow && distAhead < 0.04 && leadingCar && leadingCar.inPitPhase === 0 && leadingCar.tyreWear > 35 && car.tyreWear > 40 && !car.wantsToPit && Math.random() < car.skill) {
                car.wantsToPit = true; F1Game.broadcast.triggerEvent({ type: 'undercut', car: car });
            } else if (inPitWindow && distAhead > 0.04 && distAhead < 0.1 && leadingCar && leadingCar.inPitPhase > 0) { car.paceMode = 'PUSH'; }
            if (!isOutlap && !car.wantsToPit && car.tyreWear > car.currentLap * 7.5 && distAhead > 0.04) car.paceMode = 'SAVE';

            if (distAhead > 0 && distAhead < 0.06 && leadingCar && leadingCar.speed > 0.001) { isDirtyAir = true; dirtyAirIntensity = Math.max(0, (0.06 - distAhead) / 0.06); }
        }

        if (car.atkState && (car.atkState.phase === 'APPROACH' || car.atkState.phase === 'ALONGSIDE') && car.inPitPhase === 0) {
            idealLane = car.atkState.targetLane;
        }

        if (car.fakeMove && car.inPitPhase === 0) {
            car.fakeMoveTimer--;
            if (car.fakeMoveTimer > 20) { idealLane = car.atkState ? (car.atkState.targetLane > 0 ? -0.8 : 0.8) : (car.laneOffset > 0 ? -0.8 : 0.8); }
            else if (car.fakeMoveTimer > 0) { idealLane = car.atkState ? car.atkState.targetLane : 1.0; rawTargetVelocity *= 1.05; }
            else { car.fakeMove = false; }
        }

        if (!overtakingAllowed && car.inPitPhase === 0 && raceState !== 'SC') idealLane = car.laneOffset;

        {
            const emMod = emotionToModifiers(car.emotion || 'neutral', car.gripConfidence);
            rawTargetVelocity *= emMod.speedMult;
            if (emMod.brakeMod !== 1.0 && rawTargetVelocity < car.speed) { rawTargetVelocity *= emMod.brakeMod; }
            if (car.atkState && car.atkState.phase === 'APPROACH' && emMod.overtakeMult !== undefined) {
                if (emMod.overtakeMult < 1.0 && Math.random() < (1 - emMod.overtakeMult) * 0.05) { car.atkState.phase = 'ABORT'; car.atkState.timer = 60; }
                else if (emMod.overtakeMult > 1.2) { rawTargetVelocity *= 1.0 + (emMod.overtakeMult - 1.0) * 0.02; }
            }
        }

        car.drsActive = (raceState === 'GREEN' || (raceState === 'QUALIFYING' && car.qPhase === 'HOT_LAP')) && trackWetness < 0.1 && DRS_ZONES.some(z => (z.s > z.e) ? (frac >= z.s || frac <= z.e) : (frac >= z.s && frac <= z.e)) && slipstreaming && car.uiPos > 1 && !car.hasWingDamage;
        if (car.drsActive) rawTargetVelocity *= 1.15; else if (slipstreaming && raceState === 'GREEN' && trackWetness < 0.1) rawTargetVelocity *= 1.05;

        if (car.isLiftCoasting && !isAttacking && !car.drsActive) rawTargetVelocity *= 0.96;

        car.ersMode = 'HARV';
        if (raceState === 'QUALIFYING') { car.ersMode = car.qPhase === 'HOT_LAP' ? 'DEPLOY' : 'HARV'; }
        else if (raceState === 'GREEN' && car.inPitPhase === 0 && trackWetness < 0.3) {
            if (car.paceMode === 'PUSH') car.ersMode = 'DEPLOY';
            if (car.ersBattery > 10 && car.paceMode !== 'SAVE') {
                if (isAttacking || (car.drsActive && distAhead < 0.04)) car.ersMode = 'DEPLOY';
                else if (distBehind < 0.06 && trailingCar && (trailingCar.ersMode === 'DEPLOY' || trailingCar.drsActive || (trailingCar.overtakeState && trailingCar.overtakeState.committed))) car.ersMode = 'DEFEND';
            }
            if (distAhead > 0.02 && distAhead < 0.06 && !isAttacking && car.paceMode !== 'PUSH') car.ersMode = 'HARV';
        }
        if ((car.ersMode === 'DEPLOY' || car.ersMode === 'DEFEND') && car.ersBattery < 2.0) car.ersMode = 'HARV';

        if (adjacentCar && !car.inPitPhase) {
            if (car.laneOffset >= adjacentCar.laneOffset) idealLane = Math.max(idealLane, adjacentCar.laneOffset + 1.0);
            else idealLane = Math.min(idealLane, adjacentCar.laneOffset - 1.0);
        }

        let clampLane = Math.max(-1.18, Math.min(car.inPitPhase > 0 ? 3.8 : 1.18, idealLane));
        if ((car.launchState === 'BOGGED' || car.launchState === 'PERFECT' || car.launchState === 'NORMAL' || car.launchState === 'JUMPED') && car.displayKmh < 120 && car.inPitPhase === 0) {
            clampLane = Math.max(-0.65, Math.min(0.65, clampLane));
        }

        return { tVel: rawTargetVelocity, tLane: clampLane, wGrip: envGrip, dirtyAir: isDirtyAir, wakeForce: dirtyAirIntensity, launchAccel: launchBoost };
    }
}

class PhysicsEngine {
    static apply(car, intents, trackData, allCars, raceState, envObj, dt, gameEngine) {
        if (car.qPhase === 'DONE') {
            const pInfo = trackData.getPointAt(car.fraction);
            if (pInfo) {
                car.speed = 0; car.brakeActive = true; car.throttlePercent = 0; car.displayKmh = 0;
                car.targetLane = 3.8; car.laneOffset += (car.targetLane - car.laneOffset) * 0.05 * dt;
                car.x = pInfo.x + (pInfo.nx * car.laneOffset * TRACK_WIDTH_PX / 2.2);
                car.y = pInfo.y + (pInfo.ny * car.laneOffset * TRACK_WIDTH_PX / 2.2);
                car.tangAngle = Math.atan2(pInfo.tangY, pInfo.tangX);
            }
            return;
        }

        const pInfo = trackData.getPointAt(car.fraction); if (!pInfo) return;
        const turnForce = trackData.trackCurvature[pInfo.idx].val;

        if (car.retired) {
            car.speed *= Math.pow(0.96, dt); car.brakeActive = true; car.throttlePercent = 0.0; car.displayKmh = 0; car.gear = 0; car.rpm = 0;
            car.targetLane = (car.laneOffset > 0 ? 1.5 : -1.5);
            car.laneOffset += (car.targetLane - car.laneOffset) * 0.02 * dt;
            car.x = pInfo.x + (pInfo.nx * car.laneOffset * TRACK_WIDTH_PX / 2.2); car.y = pInfo.y + (pInfo.ny * car.laneOffset * TRACK_WIDTH_PX / 2.2); car.tangAngle = Math.atan2(pInfo.tangY, pInfo.tangX);
            return;
        }

        if (car.isSpinning) {
            car.spinTimer -= dt; car.throttlePercent = 0; car.brakeActive = true;
            car.speed *= Math.pow(0.85, dt); car.tangAngle += 0.3 * dt; car.displayKmh *= Math.pow(0.85, dt);
            car.x = pInfo.x + (pInfo.nx * car.laneOffset * TRACK_WIDTH_PX / 2.2); car.y = pInfo.y + (pInfo.ny * car.laneOffset * TRACK_WIDTH_PX / 2.2);
            if (car.spinTimer <= 0) { car.isSpinning = false; car.speed = 0; }
            return;
        }

        car.targetVelocitySmoothed += (intents.tVel - car.targetVelocitySmoothed) * 0.05 * dt;
        let speedGap = car.targetVelocitySmoothed - car.speed;
        let accelBonus = intents.launchAccel;
        if (car.ersMode === 'DEPLOY' || car.ersMode === 'DEFEND') {
            if (car.throttlePercent > 0.5 && car.displayKmh > 90) { car.ersBattery -= 0.15 * dt; accelBonus = 1.35; speedGap *= 1.04; }
        }

        let effectiveGrip = intents.wGrip;
        if (car.drsActive) effectiveGrip *= 0.88;
        if (intents.wakeForce > 0) effectiveGrip *= (1.0 - intents.wakeForce * 0.15);

        let baseAccel = 0.000032; let baseBrake = 0.000058;
        const brakingGripScale = Math.max(0.3, car.pacejkaGrip || 1.0);
        let appliedAccel = 0; let appliedBrake = 0;

        if (car.shiftTimer > 0) {
            car.shiftTimer -= dt; car.throttlePercent = 0.1; car.rpm = Math.max(4000, car.rpm - 1500 * dt);
            car.speed *= Math.pow(0.998, dt);
        } else {
            if (speedGap > 0) {
                let tractionEff = Math.max(0.2, 1.0 - (car.wheelspin * 0.6));
                appliedAccel = Math.min(baseAccel * effectiveGrip * accelBonus * tractionEff * dt, speedGap * 0.2);
                car.speed += appliedAccel; car.brakeActive = false; car.throttlePercent = 1.0;
            } else if (speedGap < 0) {
                appliedBrake = Math.min(baseBrake * Math.max(0.2, effectiveGrip) * brakingGripScale * dt, Math.abs(speedGap) * 0.3);
                car.speed -= appliedBrake; car.brakeActive = speedGap < -0.00005; car.throttlePercent = 0.0;
            }
        }

        if (car.launchState === 'BOGGED') car.rpm = 2000;
        else if (car.launchState === 'PERFECT') {
            if (gameEngine && Math.floor(gameEngine.frames) % 4 === 0) gameEngine.spawnParticles(car.x, car.y, 0, 0, '#ddd', 10, dt);
        }

        car.brakeGlow = Math.max(0, Math.min(1.0, car.brakeGlow + (car.brakeActive ? 0.08 : -0.04) * dt));
        if (appliedBrake > 0) { car.bodyPitch += (appliedBrake * 30000 * dt); }
        else if (appliedAccel > 0) { car.bodyPitch -= (appliedAccel * 15000 * dt); }
        car.bodyPitch *= Math.pow(0.85, dt); car.bodyPitch = Math.max(-1.5, Math.min(1.5, car.bodyPitch));

        let turnDir = trackData.trackCurvature[pInfo.idx].sign;
        let latG = turnForce * (car.displayKmh * car.displayKmh) * 0.0003;
        car.bodyRoll += (turnDir * latG - car.bodyRoll) * 0.1 * dt;
        car.bodyRoll *= Math.pow(0.9, dt);

        let downforceG = (car.displayKmh * car.displayKmh) * 0.000002;
        car.rideHeight = 2.0 - downforceG;
        car.isBottomingOut = car.rideHeight < 0.6;

        if (car.isBottomingOut && car.displayKmh > 260 && Math.random() < 0.4 && gameEngine) {
            for (let i = 0; i < 3; i++) { gameEngine.particles.push({ x: car.x, y: car.y, vx: -Math.cos(car.tangAngle) * car.displayKmh / 50 + (Math.random() - 0.5) * 2, vy: -Math.sin(car.tangAngle) * car.displayKmh / 50 + (Math.random() - 0.5) * 2, life: 1.0, clr: '#ffdd55', type: 'spark', maxLife: 15 + Math.random() * 10 }); }
        }

        if (car.brakeActive && car.displayKmh > 120 && gameEngine && gameEngine.skidMarks.length < 500) {
            gameEngine.skidMarks.push({ x: car.x, y: car.y, a: car.tangAngle, life: 1.0, maxLife: 3000 + Math.random() * 2000, off: car.laneOffset });
        } else if (car.isSpinning && gameEngine && gameEngine.skidMarks.length < 500) {
            gameEngine.skidMarks.push({ x: car.x, y: car.y, a: car.tangAngle + car.steerAngle, life: 1.5, maxLife: 5000, off: car.laneOffset });
        }
        if ((car.isSpinning || (car.brakeActive && car.displayKmh > 150 && speedGap < -0.001)) && Math.random() < 0.6 && gameEngine) {
            gameEngine.particles.push({ x: car.x, y: car.y, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), life: 1.0, clr: 'rgba(200,200,200,0.6)', type: 'smoke', maxLife: 20 + Math.random() * 30 });
        }

        const surfaceTempFromRain = 35 - (envObj.wet * 14.0);
        let ambientT = surfaceTempFromRain;
        let coolingBase = 0.004 + envObj.wet * 0.022;
        if (intents.wakeForce > 0) coolingBase *= (1.0 - intents.wakeForce);
        let speedFriction = (car.displayKmh / 340) * 0.35;
        let accelHeat = car.throttlePercent * 0.2;
        let brakeHeat = car.brakeActive ? 0.6 : 0;
        let tG = turnForce * car.displayKmh * 0.15;
        let isLeftTurn = turnDir < 0;

        let loadFL = speedFriction + brakeHeat * 0.8 + (isLeftTurn ? tG * 0.3 : tG * 0.8);
        let loadFR = speedFriction + brakeHeat * 0.8 + (!isLeftTurn ? tG * 0.3 : tG * 0.8);
        let loadRL = speedFriction + accelHeat * 0.8 + (isLeftTurn ? tG * 0.3 : tG * 0.8);
        let loadRR = speedFriction + accelHeat * 0.8 + (!isLeftTurn ? tG * 0.3 : tG * 0.8);

        car.tyreTemps[0] += (loadFL - (car.tyreTemps[0] - ambientT) * coolingBase) * dt;
        car.tyreTemps[1] += (loadFR - (car.tyreTemps[1] - ambientT) * coolingBase) * dt;
        car.tyreTemps[2] += (loadRL - (car.tyreTemps[2] - ambientT) * coolingBase) * dt;
        car.tyreTemps[3] += (loadRR - (car.tyreTemps[3] - ambientT) * coolingBase) * dt;
        for (let i = 0; i < 4; i++) car.tyreTemps[i] = Math.max(ambientT, car.tyreTemps[i]);

        if (speedGap < 0 && car.displayKmh > 50) { car.ersBattery += 0.4 * dt; }
        else if (car.ersMode === 'HARV' && car.throttlePercent > 0.1) { car.ersBattery += 0.06 * dt; }
        car.ersBattery = Math.max(0, Math.min(100, car.ersBattery));

        car.speed = Math.max(0, car.speed);
        car.displayKmh += (((car.speed / MAX_BASE_SPEED) * 335) - car.displayKmh) * 0.1 * dt;

        let lateralVelocity = car.laneVelocity * TRACK_WIDTH_PX / 2.2 * car.speed * 80;
        let targetSlip = Math.atan2(lateralVelocity, Math.max(0.001, car.speed)) * (180 / Math.PI);
        car.smoothedSlipAngle = (car.smoothedSlipAngle || 0) + (Math.max(-15, Math.min(15, targetSlip)) - (car.smoothedSlipAngle || 0)) * (0.15 * dt);
        car.slipAngle = car.smoothedSlipAngle;

        let avgTyreTemp = (car.tyreTemps[0] + car.tyreTemps[1] + car.tyreTemps[2] + car.tyreTemps[3]) / 4;
        car.pacejkaGrip = getTyreGrip(car.tyreWear, avgTyreTemp, car.tyreType);
        intents.wGrip *= (0.6 + car.pacejkaGrip * 0.4);

        const surfInfo = getSurfaceGrip(car);
        car.surfaceType = surfInfo.type;
        if (surfInfo.type !== 'tarmac') {
            intents.wGrip *= surfInfo.grip;
            if (car.displayKmh > 30) { car.speed *= Math.pow(1.0 / surfInfo.dragMult, dt * 0.05); }
            else if (car.displayKmh > 5) { car.speed *= Math.pow(1.0 / (1 + (surfInfo.dragMult - 1) * 0.2), dt * 0.05); }

            if (surfInfo.type === 'gravel' && car.displayKmh > 60 && Math.random() < 0.02 * dt) {
                car.isSpinning = true; car.spinTimer = 80;
                if (gameEngine) gameEngine.addFIAMessage(`${car.name} IN GRAVEL TRAP!`, 'sc-text');
            }
        }

        if (trackRubberMap && trackMarbleMap) {
            car.trackEvolutionGrip = getTrackEvolutionGrip(car, trackData, gameEngine?.trackRubber || 0);
            intents.wGrip *= car.trackEvolutionGrip;
        }

        const isAccelPhase = speedGap > 0;
        const torqueFactor = computeTorqueOutput(car, car.throttlePercent, car.rpm, isAccelPhase);
        if (!isAccelPhase && car.throttlePercent < 0.1) {
            car.engineBrakeForce = Math.max(0, -torqueFactor * 0.000008);
            car.speed = Math.max(0, car.speed - car.engineBrakeForce * dt);
        }

        let wheelspinRisk = 0;
        if (appliedAccel > 0 && car.displayKmh < 120) {
            wheelspinRisk = (1.0 - intents.wGrip) * 0.5 + (1.0 - car.skill) * 0.3;
            if (envObj.wet > 0.1) wheelspinRisk += envObj.wet * 0.5;
            if (car.tyreWear > 70) wheelspinRisk += 0.15;
            if (car.ersMode === 'DEPLOY' && car.ersBattery > 10) wheelspinRisk += 0.1;
        }
        car.wheelspin += (wheelspinRisk * 0.3 - car.wheelspin * 0.15) * dt;
        car.wheelspin = Math.max(0, Math.min(1, car.wheelspin));
        if (car.wheelspin > 0.4 && gameEngine) {
            if (Math.random() < 0.4) {
                for (let i = 0; i < Math.floor(car.wheelspin * 2); i++) { gameEngine.particles.push({ x: car.x + (Math.random() - 0.5) * 4, y: car.y + (Math.random() - 0.5) * 4, vx: -Math.cos(car.tangAngle) * 1 + (Math.random() - 0.5) * 3, vy: -Math.sin(car.tangAngle) * 1 + (Math.random() - 0.5) * 3, life: 1.0, clr: 'rgba(220,220,200,0.3)', type: 'smoke', maxLife: 12 }); }
            }
            car.speed *= Math.pow(1 - car.wheelspin * 0.001, dt);
        }

        const typeCfg = TYRES[car.tyreType] || TYRES['SOFT'];
        if (car.wheelspin > 0.3 && car.tyreTemps[2] < typeCfg.optTemp - 10) { car.graining = Math.min(1, car.graining + 0.002 * dt); }
        else { car.graining = Math.max(0, car.graining - 0.0005 * dt); }
        let maxTemp = Math.max(...car.tyreTemps);
        if (maxTemp > typeCfg.optTemp + typeCfg.tempRange * 1.5) { car.blistering = Math.min(1, car.blistering + 0.001 * dt); }
        else { car.blistering = Math.max(0, car.blistering - 0.0003 * dt); }

        if (car.brakeActive && car.displayKmh > 150) {
            let lockupRisk = (1.0 - intents.wGrip) * 0.3 + (1.0 - car.skill) * 0.2;
            car.lockupAmount += (lockupRisk * 0.05 - car.lockupAmount * 0.1) * dt;
            car.lockupAmount = Math.max(0, Math.min(1, car.lockupAmount));
            if (car.lockupAmount > 0.5) {
                let frontWheel = Math.random() < 0.5 ? 0 : 1;
                car.flatSpots[frontWheel] = Math.min(1, car.flatSpots[frontWheel] + 0.005 * dt * car.lockupAmount);
            }
        }
        let flatSpotMax = Math.max(...car.flatSpots);
        if (flatSpotMax > 0.3) { car.speed *= Math.pow(1 - flatSpotMax * 0.002, dt); car.bumpShake = Math.max(car.bumpShake, flatSpotMax * 3); }

        for (let i = 0; i < 4; i++) {
            let targetPressure = 21.5 + (car.tyreTemps[i] / 100) * 3.0;
            car.tyrePressure[i] += (targetPressure - car.tyrePressure[i]) * 0.01 * dt;
        }

        let cornerRadius_m = (1.0 / (trackData.trackCurvature[pInfo.idx].val + 0.001)) * 4;
        let lateralAccel = (car.speed * MAX_BASE_SPEED * 335 / 3.6) * (car.speed * MAX_BASE_SPEED * 335 / 3.6) / Math.max(10, cornerRadius_m);
        car.lateralG = Math.min(6.5, lateralAccel / 9.81);
        let longAccel = (speedGap / 0.0001) * 9.81 * 0.002;
        car.longitudinalG = Math.max(-6, Math.min(4, longAccel));
        let targetYaw = car.lateralG * trackData.trackCurvature[pInfo.idx].sign * 8;
        car.yawRate += (targetYaw - car.yawRate) * 0.08 * dt;

        car.downforce = AERO.downforceBase * car.displayKmh * car.displayKmh;
        if (car.displayKmh > AERO.porpoisingThreshold && car.isBottomingOut) {
            car.porpoisingPhase += dt * 0.4;
            car.porpoisingPhase = Math.sin(car.porpoisingPhase * Math.PI * 2) * (Math.max(0, (car.displayKmh - AERO.porpoisingThreshold) / 80) * 0.5);
            car.isPorpoising = Math.abs(car.porpoisingPhase) > 0.15;
            if (car.isPorpoising) { car.speed *= Math.pow(0.9998, dt); car.bumpShake = Math.max(car.bumpShake, 4); }
        } else {
            car.porpoisingPhase *= 0.9; car.isPorpoising = false;
        }

        if (car.drsActive && car.displayKmh > 340) {
            if (Math.random() < 0.001 * dt) { car.drsActive = false; car.speed *= 0.995; }
        }

        let currFrac = car.fraction;
        BUMP_ZONES.forEach(bump => {
            let d = Math.abs(currFrac - bump.frac); if (d > 0.5) d = 1 - d;
            if (d < 0.008 && Math.abs(car.laneOffset) > 0.9) {
                let impactStr = bump.intensity * (1.0 + Math.abs(car.laneOffset) - 0.9);
                car.bumpShake = Math.max(car.bumpShake, impactStr * 8); car.curbImpact = impactStr;
                car.bodyPitch += (Math.random() - 0.5) * impactStr * 3; car.bodyRoll += (Math.random() - 0.5) * impactStr * 2;
                car.tyreWear += impactStr * 0.02 * dt; car.speed *= Math.pow(1 - impactStr * 0.001, dt);
            }
        });
        car.bumpShake = Math.max(0, car.bumpShake - 0.3 * dt); car.curbImpact = Math.max(0, car.curbImpact - 0.05 * dt);

        car.targetLane = intents.tLane; let laneError = car.targetLane - car.laneOffset;
        const laneGain = (car.atkState && (car.atkState.phase === 'APPROACH' || car.atkState.phase === 'ALONGSIDE')) || (car.defState && car.defState.phase !== 'NONE') ? 0.12 : 0.05;
        car.laneVelocity += (laneError * laneGain - car.laneVelocity * 0.18) * dt;

        if ((car.launchState === 'BOGGED' || car.launchState === 'PERFECT' || car.launchState === 'NORMAL' || car.launchState === 'JUMPED') && car.displayKmh < 120) {
            car.laneVelocity *= Math.pow(0.3, dt);
        }
        car.laneOffset += car.laneVelocity * dt;

        if (car.inPitPhase === 1 && car.laneOffset < 2.5 && car.fraction > 0.84) { car.laneOffset += (2.8 - car.laneOffset) * 0.08 * dt; }
        if (car.inPitPhase === 2 && car.laneOffset < 3.7) { car.laneOffset += (3.8 - car.laneOffset) * 0.15 * dt; }

        let targetSteer = laneError * 1.5; if (car.isSpinning) targetSteer = 3.0;
        car.steerAngle += (targetSteer - car.steerAngle) * 0.2 * dt;

        if (car.inPitPhase === 0 && raceState !== 'SC' && raceState !== 'QUALIFYING' && raceState !== 'FORMATION' && raceState !== 'GRID_WAIT') {
            allCars.forEach(o => {
                if (o === car || o.retired || o.inPitPhase > 0 || o.isSC) return;
                let dDist = (o.dist - car.dist) % 1.0;
                if (dDist > 0.5) dDist -= 1.0; else if (dDist < -0.5) dDist += 1.0;
                let lDiff = Math.abs(car.laneOffset - o.laneOffset);

                if (dDist > 0 && dDist < CAR_SPACE_FRAC * 2.5 && lDiff < 0.8 && !o.isSpinning) {
                    let closingSpeed = car.speed - o.speed;
                    let stoppingDist = closingSpeed * 0.8;

                    if (dDist < stoppingDist * CAR_SPACE_FRAC + (CAR_SPACE_FRAC * 0.8)) {
                        car.speed -= Math.max(0, closingSpeed) * 0.9 * dt;
                        car.throttlePercent *= 0.5;
                    }
                    if (dDist < CAR_SPACE_FRAC * 0.9 && car.speed > o.speed) {
                        car.speed = o.speed * 0.95;
                    }
                }
            });
        }

        if (car.inPitPhase === 0 && raceState !== 'GRID' && raceState !== 'GRID_WAIT' && raceState !== 'FORMATION') {
            allCars.forEach(o => {
                if (o === car || o.retired || o.inPitPhase > 0 || o.isSC) return;
                let dDist = (o.dist - car.dist) % 1.0; if (dDist > 0.5) dDist -= 1.0; else if (dDist < -0.5) dDist += 1.0;
                let lDiff = Math.abs(car.laneOffset - o.laneOffset);

                if (Math.abs(dDist) < CAR_SPACE_FRAC * 0.8 && lDiff < 0.6) {
                    let relSpeed = car.speed - o.speed;
                    let impactForce = Math.abs(relSpeed) * 500;
                    if (impactForce > 0.05) {
                        car.collisionShake = Math.min(10, impactForce * 2);
                        o.collisionShake = Math.min(10, impactForce * 2);
                        if (impactForce > 0.2 && Math.random() < 0.3 * impactForce) {
                            if (!car.hasWingDamage) {
                                car.wingDamageLevel = Math.min(3, car.wingDamageLevel + 1);
                                car.hasWingDamage = car.wingDamageLevel >= 1; car.hasBrokenWing = car.wingDamageLevel >= 2;
                                if (gameEngine) {
                                    for (let p = 0; p < 20; p++) gameEngine.particles.push({ x: car.x, y: car.y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 1.0, clr: car.wingDamageLevel > 1 ? '#222' : car.color, type: 'spark', maxLife: 25 });
                                }
                            }
                        }
                    }
                }
            });
        }
        car.collisionShake = Math.max(0, car.collisionShake - 0.5 * dt);

        if (car.shiftTimer <= 0) {
            if (car.displayKmh > UPSHIFT_SPEEDS[car.gear] && car.gear < 8) { car.gear++; car.shiftTimer = car.shiftDelay; }
            else if (car.displayKmh < DOWNSHIFT_SPEEDS[car.gear - 1] && car.gear > 1) { car.gear--; car.shiftTimer = Math.max(1, car.shiftDelay - 1); }
            let minSpeed = DOWNSHIFT_SPEEDS[car.gear - 1] || 0, maxSpeed = UPSHIFT_SPEEDS[car.gear] || 360;
            car.rpm = 4000 + Math.max(0, Math.min(1.0, (car.displayKmh - minSpeed) / (maxSpeed - minSpeed))) * 8000;
        }

        if (car.inPitPhase !== 2 && raceState !== 'GRID' && raceState !== 'GRID_WAIT') car.dist += car.speed * dt;

        if (raceState === 'GREEN' && car.inPitPhase === 0 && !car.retired) {
            let burnBase = 0.0013; if (car.throttlePercent > 0.8) burnBase *= 1.2; if (car.paceMode === 'PUSH') burnBase *= 1.15; if (car.paceMode === 'SAVE') burnBase *= 0.85; if (car.ersMode === 'HARV') burnBase *= 0.92;
            car.fuelBurnRate = burnBase; car.fuelLoad = Math.max(0, car.fuelLoad - burnBase * dt);

            let fuelWeightPenalty = 1.0 - (car.fuelLoad / 110.0) * 0.03;
            car.speed *= Math.pow(fuelWeightPenalty, dt * 0.1);
            let lapsLeft = Math.max(0, TOTAL_LAPS - car.currentLap);
            car.isLiftCoasting = (car.fuelLoad > 15 && lapsLeft < 2 && car.paceMode !== 'PUSH');
        }

        if (raceState === 'GREEN' && !car.retired && car.inPitPhase === 0) {
            let absLane = Math.abs(car.laneOffset);
            let fracDiff = Math.abs(car.fraction - car.trackLimitsLastFrac); if (fracDiff > 0.5) fracDiff = 1.0 - fracDiff;
            if (absLane > 1.15 && fracDiff > 0.005) {
                car.trackLimitsLastFrac = car.fraction;
                if (Math.random() < 0.15) {
                    car.trackLimitsWarnings++;
                    if (car.trackLimitsWarnings >= 3 && gameEngine) {
                        if (raceState === 'QUALIFYING') { car.lapDeleted = true; }
                        else {
                            car.timePenalty += 5;
                            if (gameEngine.addFIAMessage) gameEngine.addFIAMessage(`TRACK LIMITS PENALTY - ${car.name} (+5s)`);
                            if (gameEngine.broadcast) gameEngine.broadcast.triggerEvent({ type: 'penalty', car: car, amount: 5, penaltyReason: 'exceeding track limits' });
                        }
                        car.trackLimitsWarnings = 0;
                    } else if (gameEngine && car.id === gameEngine.camera?.focusTargetId) { gameEngine.trackLimitsFlashTimer = 60; }
                }
            }
        }

        const isLaunchPhase = (car.launchState === 'BOGGED' || car.launchState === 'PERFECT' || car.launchState === 'NORMAL' || car.launchState === 'JUMPED') && car.displayKmh < 120;
        const laneMax = car.inPitPhase > 0 ? 3.8 : (isLaunchPhase ? 0.65 : 1.45);
        car.laneOffset = Math.max(-laneMax, Math.min(laneMax, car.laneOffset));

        car.x = pInfo.x + (pInfo.nx * car.laneOffset * TRACK_WIDTH_PX / 2.2);
        car.y = pInfo.y + (pInfo.ny * car.laneOffset * TRACK_WIDTH_PX / 2.2);
        car.tangAngle = Math.atan2(pInfo.tangY, pInfo.tangX);

        if ((raceState === 'GREEN' || (raceState === 'QUALIFYING' && car.qPhase === 'HOT_LAP')) && car.dist > 0 && car.inPitPhase === 0 && !car.hasPuncture) {
            let trDrop = typeCfg.degradeMult;
            if (car.paceMode === 'PUSH') trDrop *= 1.3; else if (car.paceMode === 'SAVE') trDrop *= 0.6;
            if (car.tyreType === 'INTER' && envObj.wet < 0.1) trDrop *= 4.0;
            if (car.tyreType === 'WET' && envObj.wet < 0.3) trDrop *= 5.0;

            let heatAvgT = (car.tyreTemps[0] + car.tyreTemps[1] + car.tyreTemps[2] + car.tyreTemps[3]) / 4.0;
            let overheatFactor = Math.min(30, Math.max(0, heatAvgT - (typeCfg.optTemp + typeCfg.tempRange + 5)));
            if (overheatFactor > 0) trDrop *= (1.0 + overheatFactor * 0.015);
            let cliffMul = 1.0 + (Math.pow(car.tyreWear / 100, 2.0) * 0.8);
            let cornerStress = Math.min(1.5, 1.0 + Math.abs(turnForce) * 2.0);
            let speedFactor = Math.max(0.1, car.speed / MAX_BASE_SPEED);

            car.tyreWear += (speedFactor * trDrop * cliffMul * cornerStress * 0.016 * dt);
        } else if (car.hasPuncture) {
            car.tyreWear = 100;
        }
    }
}