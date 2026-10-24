/**
 * web/js/telemetry_hud.js
 * Glassmorphic Telemetry HUD, Interactive Playback & Real-Time Physics Parameter Engine
 * Shell Eco-Marathon Prototype — Lusail International Circuit (Milestone M3/M4)
 */

export class TelemetryHUD {
    constructor() {
        this.trackData = null;
        this.lapLength = 3676.23;
        this.numStations = 3677;

        // Playback state
        this.isPlaying = true;
        this.playbackSpeed = 1.0;
        this.currentDistance = 0.0; // s in meters
        this.currentLap = 1;

        // User Configurable Vehicle & Strategy Parameters
        this.params = {
            mode: 'burn_and_coast', // 'burn_and_coast' | 'steady_speed'
            v_high: 29.5,          // Top cutoff speed [km/h] (~8.19 m/s)
            v_low: 23.8,           // Lowest trigger speed [km/h] (~6.61 m/s)
            f_burst: 22.0,         // Motor tractive burst force [N]
            mass: 114.6,           // Vehicle + driver mass [kg]
            cd_a: 0.08,            // Aerodynamic drag area [m^2]
            crr: 0.0018,           // Rolling resistance coefficient
            target_v: 26.5,        // Steady speed target [km/h]
            car_model: 'ferrari'   // 'ferrari' | 'real_car' | 'prototype'
        };

        // Pre-computed or generated telemetry frames
        this.frames = [];
        this.simulationSummary = {};

        // DOM elements cache
        this.dom = {
            playPauseBtn: document.getElementById('btn-play-pause'),
            resetBtn: document.getElementById('btn-reset'),
            timelineSlider: document.getElementById('timeline-slider'),
            distanceReadout: document.getElementById('distance-readout'),
            lapTimeReadout: document.getElementById('lap-time-readout'),
            speedValue: document.getElementById('speed-value'),
            speedSecondary: document.getElementById('speed-secondary'),
            complianceBadge: document.getElementById('compliance-badge'),
            targetSpeedVal: document.getElementById('target-speed-val'),
            fsmPill: document.getElementById('fsm-pill'),
            powerVal: document.getElementById('power-val'),
            powerBar: document.getElementById('power-bar-fill'),
            energyVal: document.getElementById('energy-val'),
            energyRateVal: document.getElementById('energy-rate-val'),
            pacingDelta: document.getElementById('pacing-delta-val'),
            topoAlt: document.getElementById('topo-alt-val'),
            topoGrade: document.getElementById('topo-grade-val'),
            topoCurvature: document.getElementById('topo-curvature-val'),
            sparklineCanvas: document.getElementById('elevation-sparkline'),
            heatmapBtn: document.getElementById('btn-toggle-heatmap'),
            // Parameter Drawer Controls
            paramsDrawer: document.getElementById('params-panel'),
            toggleParamsBtn: document.getElementById('btn-toggle-params'),
            closeParamsBtn: document.getElementById('btn-close-params'),
            // Inputs
            inputMode: document.getElementById('param-strategy-mode'),
            sliderVHigh: document.getElementById('slider-v-high'),
            numVHigh: document.getElementById('num-v-high'),
            sliderVLow: document.getElementById('slider-v-low'),
            numVLow: document.getElementById('num-v-low'),
            sliderFBurst: document.getElementById('slider-f-burst'),
            numFBurst: document.getElementById('num-f-burst'),
            sliderMass: document.getElementById('slider-mass'),
            numMass: document.getElementById('num-mass'),
            sliderCdA: document.getElementById('slider-cda'),
            numCdA: document.getElementById('num-cda'),
            sliderCrr: document.getElementById('slider-crr'),
            numCrr: document.getElementById('num-crr'),
            selectCarModel: document.getElementById('select-car-model'),
            // Results readout inside param drawer
            resAvgSpeed: document.getElementById('param-res-avg-speed'),
            resCompliance: document.getElementById('param-res-compliance'),
            resLapTime: document.getElementById('param-res-lap-time'),
            resEnergy: document.getElementById('param-res-energy'),
            resEfficiency: document.getElementById('param-res-efficiency'),
            resPulses: document.getElementById('param-res-pulses'),
        };

        this.onPositionChangeCallback = null;
        this.onCameraChangeCallback = null;
        this.onHeatmapToggleCallback = null;
        this.onHeatmapDataCallback = null;
        this.onCarModelChangeCallback = null;
    }

    /**
     * Initializes telemetry dataset, attaches interactive controls, and starts simulation.
     */
    init(trackData, onPositionChange, onCameraChange, onHeatmapToggle, onHeatmapData, onCarModelChange) {
        this.trackData = trackData;
        this.onPositionChangeCallback = onPositionChange;
        this.onCameraChangeCallback = onCameraChange;
        this.onHeatmapToggleCallback = onHeatmapToggle;
        this.onHeatmapDataCallback = onHeatmapData;
        this.onCarModelChangeCallback = onCarModelChange;

        if (trackData.track_info) {
            this.lapLength = trackData.track_info.lap_length_m || 3676.23;
        }

        // Run initial realistic longitudinal physics simulation
        this.recalculateSimulation();

        // Bind interactive controls (HUD & Parameter Panel)
        this.setupEventListeners();
        this.setupParameterPanelListeners();

        // Initial sparkline drawing
        this.renderElevationSparkline();

        // Initial UI state
        this.updateHUD(0.0);
    }

    /**
     * Authentic Physics Simulation Engine:
     * Discretizes the 3,676m Lusail track into spatial steps ds.
     * Evaluates longitudinal dynamics:
     *   - F_aero = 0.5 * rho * CdA * v^2
     *   - F_roll = Crr * m * g * cos(theta)
     *   - F_grade = m * g * sin(theta)
     *   - F_scrub = k_scrub * m * (kappa * v^2)^2
     *   - Effective inertia m_eff = m * 1.05
     *   - Motor hysteresis [v_low, v_high]
     *   - 3-Phase BLDC & MOSFET inverter electrical loss models
     *   - Freewheel clutch decoupling (2.0 W parasitic during coast)
     */
    recalculateSimulation(newParams = {}) {
        Object.assign(this.params, newParams);

        if (!this.trackData) return;

        const centerline = this.trackData.centerline || [];
        const racing = this.trackData.racing_line || [];
        const N = centerline.length || 3677;
        this.numStations = N;

        const ds = this.lapLength / N;
        const rho = 1.184; // Air density at 30 deg C (Lusail ambient)
        const g = 9.80665;
        const k_scrub = 0.00035;
        const mass = parseFloat(this.params.mass) || 114.6;
        const mass_eff = mass * 1.05; // 5% rotational inertia contribution
        const cd_a = parseFloat(this.params.cd_a) || 0.08;
        const crr = parseFloat(this.params.crr) || 0.0018;

        let v_low = (parseFloat(this.params.v_low) || 23.8) / 3.6;
        let v_high = (parseFloat(this.params.v_high) || 29.5) / 3.6;
        if (v_high <= v_low + (0.5 / 3.6)) {
            v_high = v_low + (1.0 / 3.6);
        }
        const f_burst = parseFloat(this.params.f_burst) || 22.0;
        const isSteady = (this.params.mode === 'steady_speed');
        const v_target = (parseFloat(this.params.target_v) || 26.5) / 3.6;

        this.frames = [];
        let cumTime = 0.0;
        let cumEnergyJ = 0.0;
        let currentV = isSteady ? v_target : ((v_low + v_high) * 0.5);
        let isBurning = false;
        let pulseCount = 0;
        let burnSteps = 0;

        for (let i = 0; i < N; i++) {
            const s = (i / N) * this.lapLength;
            const cNode = centerline[i] || {};
            const rNode = racing[i] || {};

            const slope = cNode.slope || 0.0;
            const theta = Math.asin(Math.max(-0.5, Math.min(0.5, slope)));
            const alt = cNode.z || 11.7;
            const kappa = Math.abs(rNode.kappa || cNode.kappa || 0.003);

            // 1. Resistive Forces at current station and speed
            const f_aero = 0.5 * rho * cd_a * (currentV ** 2);
            const f_roll = crr * mass * g * Math.cos(theta);
            const f_grade = mass * g * Math.sin(theta);
            const f_scrub = k_scrub * mass * ((kappa * (currentV ** 2)) ** 2);
            const f_resist = f_aero + f_roll + f_grade + f_scrub;

            // 2. Tractive force determination
            let f_trac = 0.0;
            let fsm = "COAST";
            let throttle = 0.0;

            if (isSteady) {
                // Steady cruise: tractive force maintains target speed
                if (currentV < v_target) {
                    const needed_a = (v_target - currentV) * 0.5;
                    f_trac = Math.max(0.0, f_resist + mass_eff * needed_a);
                    f_trac = Math.min(95.0, f_trac);
                } else {
                    f_trac = Math.max(0.0, f_resist);
                }
                fsm = f_trac > 2.0 ? "CRUISE" : "COAST";
                throttle = f_trac > 0 ? (f_trac / 30.0) : 0.0;
            } else {
                // Burn-and-Coast Hysteresis
                if (currentV <= v_low) {
                    if (!isBurning) pulseCount++;
                    isBurning = true;
                } else if (currentV >= v_high) {
                    isBurning = false;
                }

                // Lateral grip safety envelope check: suppress pulsing if approaching tire adhesion limit
                const v_safe = Math.sqrt((0.85 * g) / Math.max(kappa, 1e-5));
                if (currentV >= v_safe * 0.95) {
                    isBurning = false;
                }

                // Downhill efficiency: don't burn if steep descent naturally accelerates vehicle
                if (slope < -0.015 && currentV >= (v_low + 0.15)) {
                    isBurning = false;
                }

                if (isBurning) {
                    // Physical motor torque demand:
                    // In sweet spot island produces f_burst. On steep hills where f_resist > f_burst,
                    // BLDC controller delivers extra tractive force (up to 95N peak) so car climbs without stalling
                    const f_demand = Math.max(f_burst, f_resist + mass_eff * 0.15);
                    f_trac = Math.min(95.0, Math.max(0.0, f_demand));
                    fsm = "BURST";
                    throttle = Math.min(1.0, f_trac / 40.0);
                    burnSteps++;
                } else {
                    f_trac = 0.0;
                    fsm = "COAST";
                    throttle = 0.0;
                }
            }

            // Downhill Competition Speed Governor: STRICTLY enforce vehicle speed <= 40.0 km/h
            let f_brake = 0.0;
            const v_comp_max = 40.0 / 3.6; // 11.11 m/s (40.0 km/h official competition maximum)
            if (currentV >= (38.5 / 3.6) && f_resist < 0) {
                // Gravity on steep downhill exceeds resistance: apply progressive mechanical braking
                const excess = currentV - (38.5 / 3.6);
                f_brake = Math.max(0.0, -f_resist + mass_eff * (excess / 0.25) * 5.0);
                if (fsm === "COAST") fsm = "BRAKE";
            }

            // 3. Equation of motion: m_eff * dv/dt = F_tractive - F_resist - F_brake
            const accel = (f_trac - f_resist - f_brake) / mass_eff;

            // Spatial integration step:
            // Realistic Newtonian floor: sqrt(0.25) = 0.5 m/s prevents vehicle moving backward
            const v_next_sq = Math.max(0.25, currentV ** 2 + 2.0 * accel * ds);
            let v_next = Math.sqrt(v_next_sq);

            // Strict competition speed ceiling: never exceed 40.0 km/h anywhere on track
            if (v_next > v_comp_max) {
                v_next = v_comp_max;
            }
            const v_avg = 0.5 * (currentV + v_next);
            const dt = ds / Math.max(0.5, v_avg);

            // 4. Electrical power modeling (BLDC + MOSFET inverter + freewheel clutch)
            let p_elec = 2.0; // Quiescent standby power (freewheel sprag clutch decouples motor)
            if (fsm === "BURST" || (isSteady && f_trac > 0)) {
                const p_mech = f_trac * v_avg;
                // Electrical losses: I^2 * R copper, MOSFET conduction & switching, iron core
                const tau = f_trac * 0.28 / 8.5; // Gear ratio 8.5:1, wheel radius 0.28m
                const i_phase = tau / 0.095; // Torque constant Kt = 0.095 N*m/A
                const p_cu = 3.0 * (i_phase ** 2) * 0.065; // Rs = 65 mOhm
                const p_fet = 6.0 * (i_phase ** 2) * 0.008; // Rds_on = 8 mOhm
                const p_sw = 48.0 * i_phase * 20e3 * 80e-9; // 48V bus, 20kHz, 80ns
                const p_core = 0.015 * (v_avg * 8.5 / 0.28);
                p_elec = p_mech + p_cu + p_fet + p_sw + p_core + 2.0;
            }

            cumTime += dt;
            cumEnergyJ += p_elec * dt;
            const cumEnergyWh = cumEnergyJ / 3600.0;

            // Reference pacing delta vs constant 26.5 km/h optimal reference
            const ghostTime = s / (26.5 / 3.6);
            const pacingDelta = cumTime - ghostTime;

            this.frames.push({
                s: s,
                t: cumTime,
                v: currentV,
                v_kmh: currentV * 3.6,
                v_target: (parseFloat(this.params.v_high) + parseFloat(this.params.v_low)) * 0.5,
                p_elec: p_elec,
                energy_wh: cumEnergyWh,
                energy_wh_km: s > 15 ? (cumEnergyWh / (s / 1000.0)) : 0.0,
                fsm_state: fsm,
                throttle: throttle,
                alt: alt,
                slope: slope,
                kappa: kappa,
                pacing_delta: pacingDelta
            });

            currentV = v_next;
        }

        // Compute aggregated lap metrics
        const totalTime = cumTime;
        const avgSpeedKmh = (this.lapLength / totalTime) * 3.6;
        const totalEnergyWh = cumEnergyJ / 3600.0;
        const distKm = this.lapLength / 1000.0;
        const energyWhKm = totalEnergyWh / distKm;
        const efficiencyKmKwh = (distKm / (totalEnergyWh || 0.001)) * 1000.0;
        const semCompliant = (avgSpeedKmh >= 25.0);
        const dutyCycle = ((burnSteps / N) * 100).toFixed(1);

        this.simulationSummary = {
            totalTime,
            avgSpeedKmh,
            avg_speed_kmh: avgSpeedKmh,
            totalEnergyWh,
            energyWhKm,
            efficiencyKmKwh,
            semCompliant,
            sem_passed: semCompliant,
            pulseCount,
            dutyCycle
        };
        this.simulationResult = this.simulationSummary;

        // Update parameter drawer readouts
        this.updateParamResultsDisplay();

        // Update target speed readout on HUD
        if (this.dom.targetSpeedVal) {
            this.dom.targetSpeedVal.textContent = isSteady
                ? `${this.params.target_v} km/h`
                : `${this.params.v_low} - ${this.params.v_high} km/h`;
        }

        // Notify 3D renderer of new speed profile and powertrain states to recolor heatmap
        if (this.onHeatmapDataCallback) {
            this.onHeatmapDataCallback(
                this.frames.map(f => f.v),
                this.frames.map(f => f.fsm_state)
            );
        }

        // Re-render sparkline
        this.renderElevationSparkline();

        // Immediately refresh HUD readouts at current distance so parameter edits reflect live
        this.updateHUD(this.currentDistance);
    }

    updateParamResultsDisplay() {
        const s = this.simulationSummary;
        if (!s.totalTime) return;

        if (this.dom.resAvgSpeed) {
            this.dom.resAvgSpeed.textContent = `${s.avgSpeedKmh.toFixed(1)} km/h`;
        }
        if (this.dom.resCompliance) {
            this.dom.resCompliance.textContent = s.semCompliant ? "✅ COMPLIANT" : "❌ BELOW 25 km/h";
            this.dom.resCompliance.className = `compliance-badge ${s.semCompliant ? 'compliant' : 'warning'}`;
        }
        if (this.dom.resLapTime) {
            this.dom.resLapTime.textContent = this.formatTime(s.totalTime);
        }
        if (this.dom.resEnergy) {
            this.dom.resEnergy.textContent = `${s.totalEnergyWh.toFixed(2)} Wh (${s.energyWhKm.toFixed(2)} Wh/km)`;
        }
        if (this.dom.resEfficiency) {
            this.dom.resEfficiency.textContent = `${s.efficiencyKmKwh.toFixed(0)} km/kWh`;
        }
        if (this.dom.resPulses) {
            this.dom.resPulses.textContent = this.params.mode === 'steady_speed'
                ? `Continuous (${s.dutyCycle}% load)`
                : `${s.pulseCount} pulses (${s.dutyCycle}% burn)`;
        }
    }

    /**
     * Binds UI controls for simulation parameter drawer
     */
    setupParameterPanelListeners() {
        // Toggle parameter panel
        if (this.dom.toggleParamsBtn && this.dom.paramsDrawer) {
            this.dom.toggleParamsBtn.addEventListener('click', () => {
                this.dom.paramsDrawer.classList.toggle('open');
            });
        }
        if (this.dom.closeParamsBtn && this.dom.paramsDrawer) {
            this.dom.closeParamsBtn.addEventListener('click', () => {
                this.dom.paramsDrawer.classList.remove('open');
            });
        }

        // Car model selector
        if (this.dom.selectCarModel) {
            this.dom.selectCarModel.addEventListener('change', (e) => {
                const model = e.target.value;
                this.params.car_model = model;
                if (this.onCarModelChangeCallback) {
                    this.onCarModelChangeCallback(model);
                }
            });
        }

        // Strategy mode radio/selector
        if (this.dom.inputMode) {
            this.dom.inputMode.addEventListener('change', (e) => {
                this.recalculateSimulation({ mode: e.target.value });
            });
        }

        // Helper to bind slider & number input pair with automatic cross-constraint
        const bindPair = (slider, num, paramKey, minVal, maxVal) => {
            if (!slider || !num) return;

            const handleVal = (val) => {
                // Ensure dynamic coupling so v_high is always strictly greater than v_low
                if (paramKey === 'v_low') {
                    const currentHigh = parseFloat(this.dom.sliderVHigh ? this.dom.sliderVHigh.value : this.params.v_high);
                    if (val >= currentHigh - 0.5) {
                        const newHigh = Math.min(39.5, +(val + 1.0).toFixed(1));
                        if (this.dom.sliderVHigh) this.dom.sliderVHigh.value = newHigh;
                        if (this.dom.numVHigh) this.dom.numVHigh.value = newHigh;
                        this.params.v_high = newHigh;
                    }
                } else if (paramKey === 'v_high') {
                    const currentLow = parseFloat(this.dom.sliderVLow ? this.dom.sliderVLow.value : this.params.v_low);
                    if (val <= currentLow + 0.5) {
                        const newLow = Math.max(15.0, +(val - 1.0).toFixed(1));
                        if (this.dom.sliderVLow) this.dom.sliderVLow.value = newLow;
                        if (this.dom.numVLow) this.dom.numVLow.value = newLow;
                        this.params.v_low = newLow;
                    }
                }
                this.recalculateSimulation({ [paramKey]: val });
            };

            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                num.value = val;
                handleVal(val);
            });
            num.addEventListener('input', (e) => {
                let val = parseFloat(e.target.value);
                if (isNaN(val)) return;
                val = Math.max(minVal, Math.min(maxVal, val));
                slider.value = val;
                handleVal(val);
            });
        };

        bindPair(this.dom.sliderVHigh, this.dom.numVHigh, 'v_high', 16.0, 39.5);
        bindPair(this.dom.sliderVLow, this.dom.numVLow, 'v_low', 15.0, 38.0);
        bindPair(this.dom.sliderFBurst, this.dom.numFBurst, 'f_burst', 10.0, 60.0);
        bindPair(this.dom.sliderMass, this.dom.numMass, 'mass', 75.0, 180.0);
        bindPair(this.dom.sliderCdA, this.dom.numCdA, 'cd_a', 0.04, 0.25);
        bindPair(this.dom.sliderCrr, this.dom.numCrr, 'crr', 0.0010, 0.0050);

        // Preset buttons
        const presets = {
            'btn-preset-optimal': { mode: 'burn_and_coast', v_high: 29.5, v_low: 23.8, f_burst: 22.0, mass: 114.6, cd_a: 0.08, crr: 0.0018 },
            'btn-preset-safe': { mode: 'burn_and_coast', v_high: 28.5, v_low: 24.5, f_burst: 20.0, mass: 114.6, cd_a: 0.08, crr: 0.0018 },
            'btn-preset-sprint': { mode: 'burn_and_coast', v_high: 34.0, v_low: 27.0, f_burst: 32.0, mass: 114.6, cd_a: 0.08, crr: 0.0018 },
            'btn-preset-reset': { mode: 'burn_and_coast', v_high: 29.5, v_low: 23.8, f_burst: 22.0, mass: 114.6, cd_a: 0.08, crr: 0.0018 }
        };

        Object.keys(presets).forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const p = presets[btnId];
                    this.applyPresetValues(p);
                });
            }
        });
    }

    applyPresetValues(p) {
        if (p.mode && this.dom.inputMode) this.dom.inputMode.value = p.mode;
        if (p.v_high !== undefined) {
            if (this.dom.sliderVHigh) this.dom.sliderVHigh.value = p.v_high;
            if (this.dom.numVHigh) this.dom.numVHigh.value = p.v_high;
        }
        if (p.v_low !== undefined) {
            if (this.dom.sliderVLow) this.dom.sliderVLow.value = p.v_low;
            if (this.dom.numVLow) this.dom.numVLow.value = p.v_low;
        }
        if (p.f_burst !== undefined) {
            if (this.dom.sliderFBurst) this.dom.sliderFBurst.value = p.f_burst;
            if (this.dom.numFBurst) this.dom.numFBurst.value = p.f_burst;
        }
        if (p.mass !== undefined) {
            if (this.dom.sliderMass) this.dom.sliderMass.value = p.mass;
            if (this.dom.numMass) this.dom.numMass.value = p.mass;
        }
        if (p.cd_a !== undefined) {
            if (this.dom.sliderCdA) this.dom.sliderCdA.value = p.cd_a;
            if (this.dom.numCdA) this.dom.numCdA.value = p.cd_a;
        }
        if (p.crr !== undefined) {
            if (this.dom.sliderCrr) this.dom.sliderCrr.value = p.crr;
            if (this.dom.numCrr) this.dom.numCrr.value = p.crr;
        }
        this.recalculateSimulation(p);
    }

    /**
     * Binds HUD controls: playback, scrubber, camera perspectives, keyboard shortcuts
     */
    setupEventListeners() {
        if (this.dom.playPauseBtn) {
            this.dom.playPauseBtn.addEventListener('click', () => {
                this.isPlaying = !this.isPlaying;
                this.updatePlayPauseButton();
            });
        }

        if (this.dom.resetBtn) {
            this.dom.resetBtn.addEventListener('click', () => {
                this.seekTo(0.0);
            });
        }

        if (this.dom.timelineSlider) {
            this.dom.timelineSlider.max = Math.floor(this.lapLength);
            this.dom.timelineSlider.addEventListener('input', (e) => {
                const s = parseFloat(e.target.value);
                this.seekTo(s);
            });
        }

        const multipliers = [0.5, 1.0, 2.0, 5.0, 10.0];
        multipliers.forEach(mult => {
            const btn = document.getElementById(`btn-speed-${mult.toString().replace('.', '')}x`);
            if (btn) {
                btn.addEventListener('click', () => {
                    this.playbackSpeed = mult;
                    document.querySelectorAll('.btn-multiplier').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            }
        });

        const camModes = ['orbit', 'chase', 'cockpit', 'map'];
        camModes.forEach(mode => {
            const btn = document.getElementById(`btn-cam-${mode}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.hud-btn[data-cam]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    if (this.onCameraChangeCallback) {
                        this.onCameraChangeCallback(mode);
                    }
                });
            }
        });

        if (this.dom.heatmapBtn) {
            let mode = 'speed';
            this.dom.heatmapBtn.addEventListener('click', () => {
                mode = (mode === 'speed') ? 'burn_coast' : 'speed';
                this.dom.heatmapBtn.textContent = (mode === 'speed') ? "🎨 Speed Heatmap" : "⚡ Burn/Coast Zones";
                if (this.onHeatmapToggleCallback) {
                    this.onHeatmapToggleCallback(mode);
                }
            });
        }

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.isPlaying = !this.isPlaying;
                this.updatePlayPauseButton();
            } else if (e.code === 'ArrowRight') {
                this.seekTo(this.currentDistance + 25.0);
            } else if (e.code === 'ArrowLeft') {
                this.seekTo(this.currentDistance - 25.0);
            } else if (e.code === 'KeyR') {
                this.seekTo(0.0);
            }
        });
    }

    updatePlayPauseButton() {
        if (!this.dom.playPauseBtn) return;
        if (this.isPlaying) {
            this.dom.playPauseBtn.innerHTML = "<span>⏸ Pause</span>";
            this.dom.playPauseBtn.style.background = "#00f5d4";
        } else {
            this.dom.playPauseBtn.innerHTML = "<span>▶ Play</span>";
            this.dom.playPauseBtn.style.background = "#2ec4b6";
        }
    }

    /**
     * Advances playback clock and updates telemetry dashboard
     */
    update(dt) {
        if (this.frames.length === 0) return;

        if (this.isPlaying) {
            const frame = this.getFrameAtDistance(this.currentDistance);
            const v = frame.v || 7.36;

            this.currentDistance += v * dt * this.playbackSpeed;

            if (this.currentDistance >= this.lapLength) {
                this.currentDistance -= this.lapLength;
                this.currentLap += 1;
            }
        }

        this.updateHUD(this.currentDistance);

        if (this.onPositionChangeCallback) {
            const frame = this.getFrameAtDistance(this.currentDistance);
            this.onPositionChangeCallback(this.currentDistance, frame.v_kmh || 26.5, dt);
        }
    }

    seekTo(s) {
        let normS = s % this.lapLength;
        if (normS < 0) normS += this.lapLength;

        this.currentDistance = normS;
        this.updateHUD(this.currentDistance);

        if (this.onPositionChangeCallback) {
            const frame = this.getFrameAtDistance(this.currentDistance);
            this.onPositionChangeCallback(this.currentDistance, frame.v_kmh || 26.5, 0.016);
        }
    }

    getFrameAtDistance(s) {
        const N = this.frames.length;
        if (N === 0) return {};

        const normS = Math.max(0, Math.min(this.lapLength, s % this.lapLength));
        const idx = Math.floor((normS / this.lapLength) * (N - 1));
        return this.frames[idx] || this.frames[0];
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(2);
        const minStr = mins < 10 ? `0${mins}` : `${mins}`;
        const secStr = parseFloat(secs) < 10 ? `0${secs}` : `${secs}`;
        return `${minStr}:${secStr}`;
    }

    updateHUD(s) {
        const frame = this.getFrameAtDistance(s);
        if (!frame) return;

        if (this.dom.timelineSlider) {
            this.dom.timelineSlider.value = Math.floor(s);
        }
        if (this.dom.distanceReadout) {
            const pct = ((s / this.lapLength) * 100).toFixed(1);
            this.dom.distanceReadout.textContent = `s = ${s.toFixed(0)} m / ${this.lapLength.toFixed(0)} m (${pct}%)`;
        }

        if (this.dom.lapTimeReadout) {
            this.dom.lapTimeReadout.textContent = this.formatTime(frame.t || 0);
        }

        if (this.dom.speedValue) {
            this.dom.speedValue.textContent = (frame.v_kmh || 0).toFixed(1);
        }
        if (this.dom.speedSecondary) {
            this.dom.speedSecondary.textContent = `(${((frame.v || 0)).toFixed(2)} m/s)`;
        }

        if (this.dom.complianceBadge) {
            const isCompliant = (frame.v_kmh || 0) >= 25.0;
            this.dom.complianceBadge.textContent = isCompliant ? "COMPLIANT" : "BELOW TARGET";
            this.dom.complianceBadge.className = `compliance-badge ${isCompliant ? 'compliant' : 'warning'}`;
        }

        if (this.dom.fsmPill) {
            const fsm = frame.fsm_state || "COAST";
            this.dom.fsmPill.textContent = fsm;
            this.dom.fsmPill.className = `fsm-pill ${fsm.toLowerCase()}`;
        }

        if (this.dom.powerVal) {
            this.dom.powerVal.textContent = Math.round(frame.p_elec || 0);
        }
        if (this.dom.powerBar) {
            const pct = Math.min(100, Math.max(0, ((frame.p_elec || 0) / 250.0) * 100));
            this.dom.powerBar.style.width = `${pct}%`;
        }

        if (this.dom.energyVal) {
            this.dom.energyVal.textContent = (frame.energy_wh || 0).toFixed(2);
        }
        if (this.dom.energyRateVal) {
            this.dom.energyRateVal.textContent = (frame.energy_wh_km || 0).toFixed(2);
        }

        if (this.dom.pacingDelta) {
            const delta = frame.pacing_delta || 0.0;
            const sign = delta >= 0 ? "+" : "-";
            const absDelta = Math.abs(delta).toFixed(2);
            this.dom.pacingDelta.textContent = `${sign}${absDelta} s`;
            this.dom.pacingDelta.className = `delta-tag ${delta <= 0 ? 'ahead' : 'behind'}`;
        }

        if (this.dom.topoAlt) {
            this.dom.topoAlt.textContent = `${(frame.alt || 11.7).toFixed(1)} m`;
        }
        if (this.dom.topoGrade) {
            const gradePct = ((frame.slope || 0.0) * 100).toFixed(1);
            this.dom.topoGrade.textContent = `${gradePct > 0 ? '+' : ''}${gradePct}%`;
        }
        if (this.dom.topoCurvature) {
            this.dom.topoCurvature.textContent = `${(frame.kappa || 0.0).toFixed(4)} m⁻¹`;
        }

        this.updateSparklineBead(s);
    }

    renderElevationSparkline() {
        const canvas = this.dom.sparklineCanvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.clientWidth * window.devicePixelRatio || 260;
        const h = canvas.height = canvas.clientHeight * window.devicePixelRatio || 70;

        ctx.clearRect(0, 0, w, h);

        if (this.frames.length < 2) return;

        const alts = this.frames.map(f => f.alt || 11.7);
        const minAlt = Math.min(...alts) - 0.5;
        const maxAlt = Math.max(...alts) + 0.5;
        const range = maxAlt - minAlt || 1.0;

        ctx.beginPath();
        for (let i = 0; i < this.frames.length; i++) {
            const x = (i / (this.frames.length - 1)) * w;
            const y = h - ((alts[i] - minAlt) / range) * (h - 14) - 7;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = 2 * window.devicePixelRatio;
        ctx.stroke();

        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(0, 245, 212, 0.25)');
        grad.addColorStop(1, 'rgba(0, 245, 212, 0.0)');
        ctx.fillStyle = grad;
        ctx.fill();
    }

    updateSparklineBead(s) {
        const canvas = this.dom.sparklineCanvas;
        if (!canvas || this.frames.length < 2) return;

        this.renderElevationSparkline();

        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        const alts = this.frames.map(f => f.alt || 11.7);
        const minAlt = Math.min(...alts) - 0.5;
        const maxAlt = Math.max(...alts) + 0.5;
        const range = maxAlt - minAlt || 1.0;

        const progress = Math.max(0, Math.min(1, s / this.lapLength));
        const beadX = progress * w;
        const frame = this.getFrameAtDistance(s);
        const beadY = h - (((frame.alt || 11.7) - minAlt) / range) * (h - 14) - 7;

        ctx.beginPath();
        ctx.arc(beadX, beadY, 4.5 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = 2 * window.devicePixelRatio;
        ctx.stroke();
    }
}
