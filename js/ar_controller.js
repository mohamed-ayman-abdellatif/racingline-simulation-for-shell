/**
 * web/js/ar_controller.js
 * Dual-Mode Augmented Reality Controller (WebXR immersive-ar + WebRTC Camera Stream Fallback)
 * Shell Eco-Marathon Prototype — Lusail International Circuit (Milestone M3)
 */

export class ARController {
    constructor(renderer, scene, camera, trackRenderer) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.trackRenderer = trackRenderer;

        this.isARActive = false;
        this.currentMode = 'none'; // 'webxr' | 'webrtc' | 'none'
        this.xrSession = null;
        this.mediaStream = null;

        this.videoElement = document.getElementById('ar-camera-video');
        this.arButton = document.getElementById('btn-toggle-ar');
        this.arStatusTag = document.getElementById('ar-status-indicator');

        this.boundOrientationHandler = this.handleDeviceOrientation.bind(this);

        this.init();
    }

    async init() {
        if (this.arButton) {
            this.arButton.addEventListener('click', () => this.toggleAR());
        }

        const caps = await this.checkCapabilities();
        if (this.arStatusTag) {
            if (caps.hasWebXR) {
                this.arStatusTag.textContent = "WebXR Ready";
                this.arStatusTag.style.color = "#00f5d4";
            } else if (caps.hasCamera) {
                this.arStatusTag.textContent = "Pass-Through Ready";
                this.arStatusTag.style.color = "#00b4d8";
            } else {
                this.arStatusTag.textContent = "3D Mode";
                this.arStatusTag.style.color = "#94a3b8";
            }
        }
    }

    /**
     * Inspect browser capabilities for WebXR immersive-ar and WebRTC camera stream
     */
    async checkCapabilities() {
        let hasWebXR = false;
        let hasCamera = false;

        if (navigator.xr && navigator.xr.isSessionSupported) {
            try {
                hasWebXR = await navigator.xr.isSessionSupported('immersive-ar');
            } catch (e) {
                hasWebXR = false;
            }
        }

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            hasCamera = true;
        }

        return { hasWebXR, hasCamera };
    }

    /**
     * Toggles between AR and standard 3D Scene View
     */
    async toggleAR() {
        if (this.isARActive) {
            await this.stopAR();
        } else {
            await this.startAR();
        }
    }

    /**
     * Launches AR: Tries Mode A (Native WebXR) first; falls back to Mode B (WebRTC)
     */
    async startAR() {
        const caps = await this.checkCapabilities();

        // 1. Try Mode A: Native WebXR immersive-ar
        if (caps.hasWebXR) {
            try {
                console.log("[ARController] Requesting native WebXR immersive-ar session...");
                const sessionInit = {
                    requiredFeatures: ['local'],
                    optionalFeatures: ['hit-test', 'dom-overlay']
                };

                const hudContainer = document.getElementById('hud-container');
                if (hudContainer) {
                    sessionInit.domOverlay = { root: hudContainer };
                }

                this.xrSession = await navigator.xr.requestSession('immersive-ar', sessionInit);
                this.renderer.xr.enabled = true;
                await this.renderer.xr.setSession(this.xrSession);

                // Scale circuit to 1:1000 tabletop holographic model
                this.trackRenderer.setTabletopScale(true);

                this.xrSession.addEventListener('end', () => this.handleSessionEnded());
                this.isARActive = true;
                this.currentMode = 'webxr';
                this.updateUI();
                return 'webxr';

            } catch (xrError) {
                console.warn("[ARController] WebXR session request failed, falling back to WebRTC:", xrError);
            }
        }

        // 2. Mode B: Universal Camera Pass-Through Fallback
        if (caps.hasCamera) {
            try {
                console.log("[ARController] Initializing WebRTC Camera Pass-Through Fallback...");
                const constraints = {
                    video: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                };

                this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

                if (this.videoElement) {
                    this.videoElement.srcObject = this.mediaStream;
                    await this.videoElement.play();
                    this.videoElement.style.display = 'block';
                }

                // Transparent WebGL background so video feed shines through
                this.renderer.setClearColor(0x000000, 0);

                // Position tabletop model nicely in front of user
                this.trackRenderer.setTabletopScale(true);
                this.enableDeviceOrientation();

                this.isARActive = true;
                this.currentMode = 'webrtc';
                this.updateUI();
                return 'webrtc';

            } catch (camError) {
                console.error("[ARController] Camera access denied or unavailable:", camError);
                alert("Camera pass-through access was denied or is unavailable on this device.");
                await this.stopAR();
                return null;
            }
        }

        alert("Neither WebXR nor camera pass-through is supported on this browser.");
        return null;
    }

    /**
     * Cleanly terminates AR mode and restores standard 3D viewport
     */
    async stopAR() {
        console.log("[ARController] Stopping AR session and restoring 3D viewport...");

        if (this.xrSession) {
            try {
                await this.xrSession.end();
            } catch (e) {
                // Ignore if already ended
            }
            this.xrSession = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.videoElement) {
            this.videoElement.srcObject = null;
            this.videoElement.style.display = 'none';
        }

        this.renderer.xr.enabled = false;
        this.renderer.setClearColor(0x090d16, 1);
        this.trackRenderer.setTabletopScale(false);
        this.disableDeviceOrientation();

        this.isARActive = false;
        this.currentMode = 'none';
        this.updateUI();
    }

    handleSessionEnded() {
        this.xrSession = null;
        this.isARActive = false;
        this.currentMode = 'none';
        this.renderer.xr.enabled = false;
        this.renderer.setClearColor(0x090d16, 1);
        this.trackRenderer.setTabletopScale(false);
        this.updateUI();
    }

    enableDeviceOrientation() {
        if (window.DeviceOrientationEvent) {
            window.addEventListener('deviceorientation', this.boundOrientationHandler);
        }
    }

    disableDeviceOrientation() {
        if (window.DeviceOrientationEvent) {
            window.removeEventListener('deviceorientation', this.boundOrientationHandler);
        }
    }

    handleDeviceOrientation(event) {
        if (!this.isARActive || this.currentMode !== 'webrtc') return;

        // Device orientation angles in degrees: alpha (yaw), beta (pitch), gamma (roll)
        const deg2rad = Math.PI / 180.0;
        const alpha = event.alpha ? (event.alpha * deg2rad) : 0;
        const beta = event.beta ? ((event.beta - 45) * deg2rad) : 0;
        const gamma = event.gamma ? (event.gamma * deg2rad) : 0;

        // Subtle tilt responsiveness
        this.camera.rotation.x = -beta * 0.4;
        this.camera.rotation.z = -gamma * 0.4;
    }

    updateUI() {
        if (!this.arButton) return;

        if (this.isARActive) {
            this.arButton.innerHTML = "<span>❌ Exit AR</span>";
            this.arButton.classList.add('active-ar');
            if (this.arStatusTag) {
                this.arStatusTag.textContent = this.currentMode === 'webxr' ? "WebXR Active" : "Camera Active";
                this.arStatusTag.style.color = "#00f5d4";
            }
        } else {
            this.arButton.innerHTML = "<span>🥽 Launch AR</span>";
            this.arButton.classList.remove('active-ar');
            if (this.arStatusTag) {
                this.arStatusTag.textContent = "3D Mode";
                this.arStatusTag.style.color = "#94a3b8";
            }
        }
    }
}
