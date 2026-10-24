/**
 * web/js/app.js
 * Main Application Coordinator
 * Shell Eco-Marathon Prototype — Lusail International Circuit (Milestone M3)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { TrackRenderer } from './track_renderer.js';
import { ARController } from './ar_controller.js';
import { TelemetryHUD } from './telemetry_hud.js';

// Expose THREE globally for utilities
window.THREE = THREE;

class LusailVisualizerApp {
    constructor() {
        this.canvas = document.getElementById('webgl-canvas');
        this.cameraMode = 'orbit'; // 'orbit' | 'chase' | 'cockpit' | 'map'
        this.lastTime = performance.now();

        // 1. Initialize Three.js Engine
        this.initEngine();

        // 2. Instantiate Subsystems
        this.trackRenderer = new TrackRenderer(this.scene, this.camera);
        this.arController = new ARController(this.renderer, this.scene, this.camera, this.trackRenderer);
        this.telemetryHUD = new TelemetryHUD();
        window.telemetryHud = this.telemetryHUD;

        // 3. Ingest Track & Strategy Data
        this.loadCircuitData();

        // 4. Window Resize & Event Listeners
        window.addEventListener('resize', () => this.onWindowResize());
    }

    initEngine() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x090d16);

        // Camera (Default Perspective)
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 5000);
        this.camera.position.set(0, 180, 360);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // OrbitControls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going underground
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    async loadCircuitData() {
        const potentialEndpoints = [
            './data/lusail_track_data.json',
            'data/lusail_track_data.json',
            '/data/lusail_track_data.json',
            '../data/lusail_track_data.json'
        ];

        let trackData = null;
        for (const url of potentialEndpoints) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    trackData = await response.json();
                    console.log(`[App] Successfully loaded circuit data from ${url}`);
                    break;
                }
            } catch (err) {
                // Try next endpoint
            }
        }

        if (!trackData) {
            console.error("[App] Failed to load lusail_track_data.json from any known endpoint.");
            return;
        }

        // Initialize 3D Track Meshes
        this.trackRenderer.loadTrackData(trackData);

        // Initialize Telemetry HUD and bind callbacks
        this.telemetryHUD.init(
            trackData,
            // On Position Changed
            (s, speedKmh, dt) => {
                this.trackRenderer.updateVehiclePosition(s, speedKmh, dt);
                // Ghost car runs on optimal pacing
                const ghostS = (s + 8.0) % this.trackRenderer.lapLength;
                this.trackRenderer.updateGhostPosition(ghostS);
            },
            // On Camera Mode Changed
            (mode) => {
                this.cameraMode = mode;
                if (mode === 'orbit') {
                    this.controls.enabled = true;
                } else {
                    this.controls.enabled = false;
                }
            },
            // On Heatmap Toggle
            (heatmapMode) => {
                this.trackRenderer.buildRacingLineRibbon(heatmapMode);
            },
            // On Heatmap Data Update
            (speeds, states) => {
                this.trackRenderer.updateRacingLineHeatmap(speeds, states);
            },
            // On Car Model Changed
            (carModel) => {
                this.trackRenderer.loadCarModel(carModel);
            }
        );

        // Start render loop
        this.startRenderLoop();
    }

    startRenderLoop() {
        // Use renderer.setAnimationLoop for seamless compatibility with WebXR
        this.renderer.setAnimationLoop((time, frame) => {
            const now = performance.now();
            const dt = Math.min((now - this.lastTime) / 1000.0, 0.1);
            this.lastTime = now;

            // 1. Advance telemetry clock
            this.telemetryHUD.update(dt);

            // 2. Update camera perspective
            if (!this.arController.isARActive) {
                this.trackRenderer.updateCameraPerspective(
                    this.cameraMode,
                    this.controls,
                    this.telemetryHUD.currentDistance
                );
            }

            // 3. Update Orbit Controls if in orbit mode
            if (this.cameraMode === 'orbit' && !this.arController.isARActive) {
                this.controls.update();
            }

            // 4. Render Frame
            this.renderer.render(this.scene, this.camera);
        });
    }

    onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        if (this.telemetryHUD) {
            this.telemetryHUD.renderElevationSparkline();
        }
    }
}

// Bootstrap application safely regardless of DOM ready state
function initApp() {
    if (!window.lusailApp) {
        window.lusailApp = new LusailVisualizerApp();
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
