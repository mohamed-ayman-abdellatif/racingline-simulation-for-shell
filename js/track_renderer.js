/**
 * web/js/track_renderer.js
 * Three.js 3D Track Ribbon, Realistic Lusail Circuit Infrastructure & Real 3D Car Models
 * Shell Eco-Marathon Prototype — Lusail International Circuit (Milestone M3/M4)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export class TrackRenderer {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        // Container groups
        this.trackGroup = new THREE.Group();
        this.scene.add(this.trackGroup);

        this.vehicleGroup = new THREE.Group();
        this.scene.add(this.vehicleGroup);

        this.ghostGroup = new THREE.Group();
        this.scene.add(this.ghostGroup);

        // Track parameters
        this.halfWidth = 5.0; // Corridor half-width (+/- 5.0m = 10m track width)
        this.elevationScale = 1.0; // True physical scale
        this.centerOffset = { x: 0, y: 0, z: 0 };
        this.lapLength = 3676.23;

        // Interpolation caches
        this.centerlinePoints = [];
        this.racingLinePoints = [];
        this.racingSpeeds = [];
        this.racingStates = [];

        // Meshes
        this.asphaltMesh = null;
        this.kerbsMesh = null;
        this.racingLineMesh = null;
        this.centerlineMesh = null;
        this.gantryMesh = null;
        this.barriersMesh = null;
        this.floodlightsGroup = null;
        this.pitComplexGroup = null;
        this.markersGroup = null;

        // Lighting
        this.setupLighting();

        // 3D Car Model setup
        this.setupCarLoaders();
        this.vehicleMesh = null;
        this.ghostMesh = null;

        // Start with real car or fallback
        this.loadCarModel('ferrari');
        this.buildGhostAvatar();
    }

    setupLighting() {
        // Soft ambient illumination with desert afternoon / night-sky tint
        const ambient = new THREE.AmbientLight(0xd8e4f2, 0.7);
        this.scene.add(ambient);

        // Sunlight / Lusail desert sun
        const sun = new THREE.DirectionalLight(0xfffaec, 1.25);
        sun.position.set(400, 650, -300);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.camera.near = 10;
        sun.shadow.camera.far = 1500;
        sun.shadow.camera.left = -500;
        sun.shadow.camera.right = 500;
        sun.shadow.camera.top = 500;
        sun.shadow.camera.bottom = -500;
        this.scene.add(sun);

        // Ground bounce hemisphere light
        const hemiLight = new THREE.HemisphereLight(0x5a7b9e, 0x1b1512, 0.55);
        this.scene.add(hemiLight);
    }

    setupCarLoaders() {
        this.dracoLoader = new DRACOLoader();
        this.dracoLoader.setDecoderPath('./lib/draco/gltf/');

        this.gltfLoader = new GLTFLoader();
        this.gltfLoader.setDRACOLoader(this.dracoLoader);

        this.wheels = [];
        this.frontWheels = [];
        this.wheelRadius = 0.35;
        this.wheelRotation = 0.0;
        this.currentCarModel = 'ferrari';
    }

    /**
     * Ingests parsed JSON data from data/lusail_track_data.json
     */
    loadTrackData(trackData) {
        const info = trackData.track_info || {};
        this.lapLength = info.lap_length_m || 3676.23;

        const centerline = trackData.centerline || [];
        const racingLine = trackData.racing_line || [];

        if (centerline.length === 0) {
            console.error("No centerline nodes found in trackData");
            return;
        }

        // Calculate geographic centroid to center Three.js coordinate system at (0, 0, 0)
        let sumX = 0, sumY = 0;
        for (let i = 0; i < centerline.length; i++) {
            sumX += centerline[i].x;
            sumY += centerline[i].y;
        }
        this.centerOffset.x = sumX / centerline.length;
        this.centerOffset.y = sumY / centerline.length;

        // Cache 3D Cartesian coordinates
        this.centerlinePoints = centerline.map(pt => ({
            s: pt.s,
            pos: new THREE.Vector3(
                pt.x - this.centerOffset.x,
                (pt.z_enu || 0.0) * this.elevationScale,
                -(pt.y - this.centerOffset.y)
            ),
            normal: new THREE.Vector3(pt.nx, 0, -pt.ny).normalize(),
            kappa: pt.kappa || 0.0,
            slope: pt.slope || 0.0,
            heading: pt.heading || 0.0,
            rawAlt: pt.z || 11.7
        }));

        this.racingLinePoints = racingLine.map(pt => ({
            s: pt.s,
            pos: new THREE.Vector3(
                pt.x - this.centerOffset.x,
                ((pt.z_enu || 0.0) * this.elevationScale) + 0.08,
                -(pt.y - this.centerOffset.y)
            ),
            v_target: pt.v_target || 7.36,
            kappa: pt.kappa || 0.0,
            alpha: pt.alpha || 0.0
        }));

        this.racingSpeeds = this.racingLinePoints.map(p => p.v_target);

        // Build complete 3D realistic Lusail track infrastructure
        this.buildTrackRibbon();
        this.buildKerbs();
        this.buildBoundariesAndCenterline();
        this.buildArmcoBarriers();
        this.buildFloodlightPylons();
        // Pit building and grandstand rectangles removed to keep track and map view clear and uncluttered
        this.buildBrakingMarkers();
        this.buildRacingLineRibbon('speed');
        this.buildStartFinishGantry();
        this.buildGroundSurroundings();

        // Position vehicles at station s = 0
        this.updateVehiclePosition(0.0, 26.5, 0.016);
        this.updateGhostPosition(0.0);
    }

    /**
     * Constructs continuous 3D road ribbon mesh covering 3,676.7m Lusail circuit
     * Width: 10.0m (+/- 5.0m corridor) with asphalt PBR material and subtle rubber groove.
     */
    buildTrackRibbon() {
        if (this.asphaltMesh) this.trackGroup.remove(this.asphaltMesh);

        const pts = this.centerlinePoints;
        const N = pts.length;
        const positions = [];
        const uvs = [];
        const indices = [];

        for (let i = 0; i < N; i++) {
            const curr = pts[i];
            const p = curr.pos;
            const nLat = curr.normal;

            // Left (+5.0m) and Right (-5.0m) vertices
            const left = new THREE.Vector3().addVectors(p, nLat.clone().multiplyScalar(this.halfWidth));
            const right = new THREE.Vector3().addVectors(p, nLat.clone().multiplyScalar(-this.halfWidth));

            positions.push(left.x, left.y, left.z);
            positions.push(right.x, right.y, right.z);

            const vProgress = (curr.s / this.lapLength) * 120.0;
            uvs.push(0.0, vProgress);
            uvs.push(1.0, vProgress);

            if (i < N - 1) {
                const i0 = 2 * i;
                const i1 = 2 * i + 1;
                const i2 = 2 * (i + 1);
                const i3 = 2 * (i + 1) + 1;

                indices.push(i0, i1, i2);
                indices.push(i1, i3, i2);
            } else {
                indices.push(2 * (N - 1), 2 * (N - 1) + 1, 0);
                indices.push(2 * (N - 1) + 1, 1, 0);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const asphaltMat = new THREE.MeshStandardMaterial({
            color: 0x1a1e26,
            roughness: 0.82,
            metalness: 0.15,
            side: THREE.DoubleSide
        });

        this.asphaltMesh = new THREE.Mesh(geometry, asphaltMat);
        this.asphaltMesh.receiveShadow = true;
        this.trackGroup.add(this.asphaltMesh);
    }

    /**
     * Builds alternating red-and-white FIA/SEM kerbs along corner apexes and track borders
     */
    buildKerbs() {
        if (this.kerbsMesh) this.trackGroup.remove(this.kerbsMesh);

        const pts = this.centerlinePoints;
        const N = pts.length;
        const positions = [];
        const colors = [];
        const indices = [];

        let vertCount = 0;
        const kerbWidth = 0.65; // 0.65m kerb width

        for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < N; i++) {
                const curr = pts[i];
                const p = curr.pos;
                const n = curr.normal;

                const wInner = (this.halfWidth - 0.05) * side;
                const wOuter = (this.halfWidth + kerbWidth) * side;

                const vInner = new THREE.Vector3().addVectors(p, n.clone().multiplyScalar(wInner));
                const vOuter = new THREE.Vector3().addVectors(p, n.clone().multiplyScalar(wOuter));
                vInner.y += 0.04;
                vOuter.y += 0.01;

                positions.push(vInner.x, vInner.y, vInner.z);
                positions.push(vOuter.x, vOuter.y, vOuter.z);

                // Alternating red/white stripes every 4 meters
                const isRed = Math.floor(curr.s / 4.0) % 2 === 0;
                const r = isRed ? 0.90 : 0.96;
                const g = isRed ? 0.08 : 0.96;
                const b = isRed ? 0.16 : 0.96;

                colors.push(r, g, b);
                colors.push(r, g, b);

                if (i < N - 1) {
                    const base = vertCount + 2 * i;
                    indices.push(base, base + 1, base + 2);
                    indices.push(base + 1, base + 3, base + 2);
                } else {
                    const base = vertCount + 2 * (N - 1);
                    indices.push(base, base + 1, vertCount);
                    indices.push(base + 1, vertCount + 1, vertCount);
                }
            }
            vertCount += 2 * N;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const kerbMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide
        });

        this.kerbsMesh = new THREE.Mesh(geometry, kerbMat);
        this.trackGroup.add(this.kerbsMesh);
    }

    /**
     * Builds solid white boundary lines and dashed track centerline
     */
    buildBoundariesAndCenterline() {
        const pts = this.centerlinePoints;
        const N = pts.length;

        const linePositions = [];
        for (let side of [-1, 1]) {
            for (let i = 0; i < N; i++) {
                const p = pts[i].pos;
                const n = pts[i].normal;
                const w = (this.halfWidth - 0.1) * side;

                const pt = new THREE.Vector3().addVectors(p, n.clone().multiplyScalar(w));
                pt.y += 0.02;
                linePositions.push(pt.x, pt.y, pt.z);
            }
        }

        const centerPositions = [];
        for (let i = 0; i < N; i++) {
            if (Math.floor(pts[i].s / 3.0) % 2 === 0) {
                const pt = pts[i].pos.clone();
                pt.y += 0.025;
                centerPositions.push(pt.x, pt.y, pt.z);
            }
        }

        const lineGeom = new THREE.BufferGeometry();
        lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
        const boundaryLines = new THREE.LineSegments(lineGeom, lineMat);
        this.trackGroup.add(boundaryLines);

        const centerGeom = new THREE.BufferGeometry();
        centerGeom.setAttribute('position', new THREE.Float32BufferAttribute(centerPositions, 3));
        const centerMat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.7 });
        this.centerlineMesh = new THREE.LineSegments(centerGeom, centerMat);
        this.trackGroup.add(this.centerlineMesh);
    }

    /**
     * Builds Armco Steel Crash Barriers along the outer corridor of the circuit
     */
    buildArmcoBarriers() {
        if (this.barriersMesh) this.trackGroup.remove(this.barriersMesh);

        const pts = this.centerlinePoints;
        const N = pts.length;
        const barrierDist = this.halfWidth + 2.2;
        const barrierH = 0.85;

        const positions = [];
        const indices = [];
        let vertCount = 0;

        const barrierMat = new THREE.MeshStandardMaterial({
            color: 0x8294a6,
            metalness: 0.85,
            roughness: 0.35,
            side: THREE.DoubleSide
        });

        // Step by 3 stations (~3m) to keep mesh lightweight
        const step = 3;
        const subIndices = [];
        for (let i = 0; i < N; i += step) subIndices.push(i);
        const M = subIndices.length;

        for (let side of [-1, 1]) {
            const startV = vertCount;
            for (let k = 0; k < M; k++) {
                const i = subIndices[k];
                const p = pts[i].pos;
                const n = pts[i].normal;

                const bx = p.x + n.x * barrierDist * side;
                const bz = p.z + n.z * barrierDist * side;
                const by = p.y + 0.08;

                positions.push(bx, by, bz);
                positions.push(bx, by + barrierH, bz);
            }

            for (let k = 0; k < M; k++) {
                const i0 = startV + 2 * k;
                const i1 = startV + 2 * k + 1;
                const i2 = startV + 2 * ((k + 1) % M);
                const i3 = startV + 2 * ((k + 1) % M) + 1;

                indices.push(i0, i1, i3);
                indices.push(i0, i3, i2);
            }
            vertCount += 2 * M;
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        this.barriersMesh = new THREE.Mesh(geom, barrierMat);
        this.trackGroup.add(this.barriersMesh);
    }

    /**
     * Lusail Circuit's Signature Night-Race Floodlight Towers
     */
    buildFloodlightPylons() {
        if (this.floodlightsGroup) this.trackGroup.remove(this.floodlightsGroup);

        const group = new THREE.Group();
        const pts = this.centerlinePoints;
        const N = pts.length;
        if (N === 0) return;

        // Place towers every ~200 meters around perimeter
        const towerSpacing = 200;
        const numTowers = Math.floor(this.lapLength / towerSpacing);

        const mastGeom = new THREE.CylinderGeometry(0.3, 0.6, 18.0, 8);
        const mastMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });

        const lampGeom = new THREE.BoxGeometry(3.5, 0.4, 0.8);
        const lampMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9, roughness: 0.2 });
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfffaed });

        for (let t = 0; t < numTowers; t++) {
            const targetS = t * towerSpacing;
            const idx = Math.floor((targetS / this.lapLength) * N) % N;
            const p = pts[idx].pos;
            const n = pts[idx].normal;

            // Place 14 meters outside the track
            const pylonPos = p.clone().add(n.clone().multiplyScalar(this.halfWidth + 14.0));
            pylonPos.y = p.y + 9.0; // Mast center

            const mast = new THREE.Mesh(mastGeom, mastMat);
            mast.position.copy(pylonPos);
            group.add(mast);

            // Overhead lamp fixture angled down toward the track
            const lamp = new THREE.Mesh(lampGeom, lampMat);
            lamp.position.copy(pylonPos);
            lamp.position.y += 9.2;
            lamp.position.add(n.clone().multiplyScalar(-2.5));
            lamp.rotation.z = n.x * 0.2;
            group.add(lamp);

            // Glowing lamp face
            const bulb = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 0.6), bulbMat);
            bulb.position.copy(lamp.position);
            bulb.position.y -= 0.21;
            bulb.rotation.x = Math.PI / 2;
            group.add(bulb);
        }

        this.floodlightsGroup = group;
        this.trackGroup.add(group);
    }

    /**
     * Pit Lane Building & Grandstand Structure along the Main Straight
     * Kept clear to avoid giant obstructive rectangles on map view.
     */
    buildPitBuildingAndGrandstand() {
        if (this.pitComplexGroup) {
            this.trackGroup.remove(this.pitComplexGroup);
            this.pitComplexGroup = null;
        }
    }

    /**
     * Braking Distance Markers (150m, 100m, 50m) and Turn Numbers
     */
    buildBrakingMarkers() {
        if (this.markersGroup) this.trackGroup.remove(this.markersGroup);

        const group = new THREE.Group();
        const pts = this.centerlinePoints;
        const N = pts.length;
        if (N === 0) return;

        // Key corner entries in Lusail (Turns 1, 2, 4, 6, 10, 12, 16)
        const cornerStations = [280, 520, 890, 1450, 2100, 2750, 3400];
        const distances = [150, 100, 50];

        const boardGeom = new THREE.BoxGeometry(0.8, 1.2, 0.08);
        const boardMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
        const postGeom = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6);
        const postMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8 });

        cornerStations.forEach((apexS, cIdx) => {
            distances.forEach(d => {
                const s = (apexS - d + this.lapLength) % this.lapLength;
                const idx = Math.floor((s / this.lapLength) * N) % N;
                const p = pts[idx].pos;
                const n = pts[idx].normal;

                const markerPos = p.clone().add(n.clone().multiplyScalar(this.halfWidth + 1.2));
                markerPos.y = p.y;

                const post = new THREE.Mesh(postGeom, postMat);
                post.position.copy(markerPos);
                post.position.y += 0.8;
                group.add(post);

                const board = new THREE.Mesh(boardGeom, boardMat);
                board.position.copy(markerPos);
                board.position.y += 1.5;
                board.rotation.y = Math.atan2(n.x, -n.z);
                group.add(board);
            });
        });

        this.markersGroup = group;
        this.trackGroup.add(group);
    }

    /**
     * Continuous 3D glowing racing line with vertex heatmap coloring
     */
    buildRacingLineRibbon(heatmapMode = 'speed') {
        if (this.racingLineMesh) this.trackGroup.remove(this.racingLineMesh);

        const rPts = this.racingLinePoints;
        const N = rPts.length;
        if (N === 0) return;

        const positions = [];
        const colors = [];
        const indices = [];

        const ribbonWidth = 0.38;

        let minV = 22.0 / 3.6, maxV = 40.0 / 3.6; // Scale from minimum competition speed to 40 km/h max
        if (this.racingSpeeds.length > 0) {
            minV = Math.max(20.0 / 3.6, Math.min(...this.racingSpeeds));
            maxV = Math.min(40.0 / 3.6, Math.max(...this.racingSpeeds));
            if (maxV <= minV) maxV = minV + 1.0;
        }

        for (let i = 0; i < N; i++) {
            const curr = rPts[i];
            const p = curr.pos;
            const nextP = rPts[(i + 1) % N].pos;
            const tangent = new THREE.Vector3().subVectors(nextP, p).normalize();
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

            const vLeft = new THREE.Vector3().addVectors(p, normal.clone().multiplyScalar(ribbonWidth * 0.5));
            const vRight = new THREE.Vector3().addVectors(p, normal.clone().multiplyScalar(-ribbonWidth * 0.5));

            positions.push(vLeft.x, vLeft.y, vLeft.z);
            positions.push(vRight.x, vRight.y, vRight.z);

            // Heatmap color
            let r, g, b;
            const currentSpeed = (this.racingSpeeds[i] !== undefined) ? this.racingSpeeds[i] : curr.v_target;

            if (heatmapMode === 'speed') {
                const norm = Math.max(0, Math.min(1, (currentSpeed - minV) / (maxV - minV)));
                if (norm < 0.5) {
                    const t = norm * 2.0;
                    r = 0.0 * (1 - t) + 0.18 * t;
                    g = 0.96 * (1 - t) + 0.85 * t;
                    b = 0.83 * (1 - t) + 0.25 * t;
                } else {
                    const t = (norm - 0.5) * 2.0;
                    r = 0.18 * (1 - t) + 1.0 * t;
                    g = 0.85 * (1 - t) + 0.35 * t;
                    b = 0.25 * (1 - t) + 0.05 * t;
                }
            } else {
                // Real simulated Burn vs Coast vs Brake state visualization
                const state = (this.racingStates && this.racingStates[i]) ? this.racingStates[i] : 'COAST';
                if (state === 'BURST') {
                    // Bright Red / Coral for Burn (#FF3B30)
                    r = 1.0; g = 0.23; b = 0.19;
                } else if (state === 'BRAKE') {
                    // Amber for downhill braking (#FBBF24)
                    r = 0.98; g = 0.75; b = 0.14;
                } else {
                    // Electric Cyan for free coasting (#00F5D4)
                    r = 0.0; g = 0.96; b = 0.83;
                }
            }

            colors.push(r, g, b);
            colors.push(r, g, b);

            if (i < N - 1) {
                const i0 = 2 * i;
                const i1 = 2 * i + 1;
                const i2 = 2 * (i + 1);
                const i3 = 2 * (i + 1) + 1;
                indices.push(i0, i1, i2);
                indices.push(i1, i3, i2);
            } else {
                indices.push(2 * (N - 1), 2 * (N - 1) + 1, 0);
                indices.push(2 * (N - 1) + 1, 1, 0);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const racingMat = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.95
        });

        this.racingLineMesh = new THREE.Mesh(geometry, racingMat);
        this.trackGroup.add(this.racingLineMesh);
    }

    /**
     * Updates racing line heatmap when simulation parameters change
     */
    updateRacingLineHeatmap(speeds, states, heatmapMode = 'speed') {
        if (speeds && speeds.length > 0) {
            this.racingSpeeds = speeds;
        }
        if (states && states.length > 0) {
            this.racingStates = states;
        }
        this.buildRacingLineRibbon(heatmapMode);
    }

    /**
     * Start / Finish Gantry structure at s = 0m
     */
    buildStartFinishGantry() {
        if (this.centerlinePoints.length === 0) return;

        const p0 = this.centerlinePoints[0].pos;
        const n0 = this.centerlinePoints[0].normal;

        const gantry = new THREE.Group();

        // 2 Vertical Columns
        const colGeom = new THREE.CylinderGeometry(0.25, 0.25, 6.2, 8);
        const trussMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.85, roughness: 0.25 });

        const leftCol = new THREE.Mesh(colGeom, trussMat);
        leftCol.position.copy(p0).add(n0.clone().multiplyScalar(this.halfWidth + 1.4));
        leftCol.position.y += 3.1;
        gantry.add(leftCol);

        const rightCol = new THREE.Mesh(colGeom, trussMat);
        rightCol.position.copy(p0).add(n0.clone().multiplyScalar(-(this.halfWidth + 1.4)));
        rightCol.position.y += 3.1;
        gantry.add(rightCol);

        // Horizontal Crossbar
        const barLen = (this.halfWidth + 1.4) * 2.0;
        const barGeom = new THREE.BoxGeometry(barLen, 0.7, 0.9);
        const barMesh = new THREE.Mesh(barGeom, trussMat);
        barMesh.position.copy(p0);
        barMesh.position.y += 6.0;

        const angle = Math.atan2(n0.x, -n0.z);
        barMesh.rotation.y = angle;
        gantry.add(barMesh);

        // 5 Red Starting Lights
        const lightGeom = new THREE.SphereGeometry(0.12, 12, 12);
        const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff0040 });
        for (let l = -2; l <= 2; l++) {
            const light = new THREE.Mesh(lightGeom, redLightMat);
            light.position.copy(barMesh.position);
            light.position.add(n0.clone().multiplyScalar(l * 1.1));
            light.position.y -= 0.55;
            gantry.add(light);
        }

        // Checkered Start/Finish Line on track surface
        const checkGeom = new THREE.PlaneGeometry(10.0, 1.4);
        const checkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
        const checkMesh = new THREE.Mesh(checkGeom, checkMat);
        checkMesh.position.copy(p0);
        checkMesh.position.y += 0.035;
        checkMesh.rotation.x = Math.PI / 2;
        checkMesh.rotation.z = angle;
        gantry.add(checkMesh);

        this.gantryMesh = gantry;
        this.trackGroup.add(gantry);
    }

    /**
     * Desert ground terrain surrounding the Lusail circuit
     */
    buildGroundSurroundings() {
        const groundGeom = new THREE.PlaneGeometry(3200, 3200, 24, 24);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x17120e, // Warm desert dusk tone
            roughness: 0.96,
            metalness: 0.04
        });
        const ground = new THREE.Mesh(groundGeom, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -5.0;
        ground.receiveShadow = true;
        this.trackGroup.add(ground);
    }

    /**
     * Loads Real 3D Car Model (Ferrari 458 Italia, Real GT Car, or SEM Prototype)
     */
    loadCarModel(modelType = 'ferrari') {
        this.currentCarModel = modelType;

        // Clean up previous vehicle mesh
        while (this.vehicleGroup.children.length > 0) {
            this.vehicleGroup.remove(this.vehicleGroup.children[0]);
        }
        this.wheels = [];
        this.frontWheels = [];

        if (modelType === 'prototype') {
            this.buildPrototypeVehicleAvatar();
            return;
        }

        const modelUrl = modelType === 'real_car' ? './models/real_car.glb' : './models/ferrari.glb';

        this.gltfLoader.load(
            modelUrl,
            (gltf) => {
                const carScene = gltf.scene;
                const wrapper = new THREE.Group();

                if (modelType === 'ferrari') {
                    // Ferrari 458 Italia (faces -Z by default, rotate 180 deg around Y to align with track +Z)
                    carScene.rotation.y = Math.PI;
                    carScene.position.y = 0.0;
                    carScene.scale.set(1.0, 1.0, 1.0);

                    // Find and store wheel nodes for dynamic rotation
                    carScene.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                        const name = (child.name || '').toLowerCase();
                        if (name.includes('wheel_fl') || name.includes('wheel_fr')) {
                            this.frontWheels.push(child);
                            this.wheels.push(child);
                        } else if (name.includes('wheel_rl') || name.includes('wheel_rr') || name.includes('wheel')) {
                            this.wheels.push(child);
                        }
                    });

                    // Add soft headlight spotlights
                    const headlightL = new THREE.SpotLight(0xfffaed, 2.5, 45, Math.PI / 7, 0.4);
                    headlightL.position.set(-0.7, 0.6, 2.0);
                    headlightL.target.position.set(-0.7, 0.0, 18.0);
                    wrapper.add(headlightL);
                    wrapper.add(headlightL.target);

                    const headlightR = new THREE.SpotLight(0xfffaed, 2.5, 45, Math.PI / 7, 0.4);
                    headlightR.position.set(0.7, 0.6, 2.0);
                    headlightR.target.position.set(0.7, 0.0, 18.0);
                    wrapper.add(headlightR);
                    wrapper.add(headlightR.target);

                } else if (modelType === 'real_car') {
                    // Real GT Car: compute bounding box and scale to ~4.3m length
                    const box = new THREE.Box3().setFromObject(carScene);
                    const size = box.getSize(new THREE.Vector3());
                    const center = box.getCenter(new THREE.Vector3());

                    const targetLen = 4.3;
                    const scaleFactor = targetLen / Math.max(size.x, size.y, size.z, 0.001);
                    carScene.scale.set(scaleFactor, scaleFactor, scaleFactor);
                    carScene.position.set(-center.x * scaleFactor, -box.min.y * scaleFactor, -center.z * scaleFactor);

                    carScene.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                }

                wrapper.add(carScene);
                this.vehicleMesh = wrapper;
                this.vehicleGroup.add(wrapper);
                console.log(`[TrackRenderer] Real 3D car model loaded: ${modelType}`);
            },
            undefined,
            (err) => {
                console.warn(`[TrackRenderer] Failed to load ${modelUrl}, falling back to prototype:`, err);
                this.buildPrototypeVehicleAvatar();
            }
        );
    }

    /**
     * High-fidelity Aerodynamic Shell Eco-Marathon Prototype Car
     */
    buildPrototypeVehicleAvatar() {
        const car = new THREE.Group();

        // 1. Aerodynamic Teardrop Carbon Fiber Monocoque
        const bodyGeom = new THREE.ConeGeometry(0.48, 2.9, 20);
        bodyGeom.rotateX(Math.PI / 2);
        bodyGeom.scale(1.0, 0.52, 1.0);

        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x111827,
            metalness: 0.88,
            roughness: 0.22
        });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.position.y = 0.24;
        car.add(body);

        // 2. Cockpit Windshield Canopy
        const canopyGeom = new THREE.SphereGeometry(0.32, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        canopyGeom.scale(0.85, 0.9, 2.0);
        const canopyMat = new THREE.MeshStandardMaterial({
            color: 0x00f5d4,
            transparent: true,
            opacity: 0.75,
            roughness: 0.1,
            metalness: 0.9
        });
        const canopy = new THREE.Mesh(canopyGeom, canopyMat);
        canopy.position.set(0, 0.30, 0.2);
        car.add(canopy);

        // 3. Delta Wheels
        const wheelGeom = new THREE.CylinderGeometry(0.24, 0.24, 0.06, 16);
        wheelGeom.rotateZ(Math.PI / 2);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

        const frontLeftWheel = new THREE.Mesh(wheelGeom, wheelMat);
        frontLeftWheel.position.set(-0.46, 0.24, 0.65);
        car.add(frontLeftWheel);

        const frontRightWheel = new THREE.Mesh(wheelGeom, wheelMat);
        frontRightWheel.position.set(0.46, 0.24, 0.65);
        car.add(frontRightWheel);

        const rearWheel = new THREE.Mesh(wheelGeom, wheelMat);
        rearWheel.position.set(0, 0.24, -0.95);
        car.add(rearWheel);

        // 4. Headlights and telemetry beacon
        const lightGeom = new THREE.SphereGeometry(0.05, 8, 8);
        const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const leftLight = new THREE.Mesh(lightGeom, lightMat);
        leftLight.position.set(-0.25, 0.25, 1.25);
        car.add(leftLight);

        const rightLight = new THREE.Mesh(lightGeom, lightMat);
        rightLight.position.set(0.25, 0.25, 1.25);
        car.add(rightLight);

        const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });
        const beacon = new THREE.Mesh(lightGeom, beaconMat);
        beacon.position.set(0, 0.58, -0.2);
        car.add(beacon);

        this.vehicleMesh = car;
        this.vehicleGroup.add(car);
    }

    /**
     * Holographic Cyan Ghost Car Avatar
     */
    buildGhostAvatar() {
        const ghost = new THREE.Group();

        const bodyGeom = new THREE.ConeGeometry(0.48, 2.8, 12);
        bodyGeom.rotateX(Math.PI / 2);
        bodyGeom.scale(1.0, 0.55, 1.0);

        const ghostMat = new THREE.MeshStandardMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.45,
            wireframe: false,
            roughness: 0.2,
            metalness: 0.8
        });

        const body = new THREE.Mesh(bodyGeom, ghostMat);
        body.position.y = 0.24;
        ghost.add(body);

        const wireMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4, wireframe: true, transparent: true, opacity: 0.6 });
        const wire = new THREE.Mesh(bodyGeom, wireMat);
        wire.position.y = 0.24;
        ghost.add(wire);

        this.ghostMesh = ghost;
        this.ghostGroup.add(ghost);
    }

    /**
     * Interpolates 3D position along racing line at distance s (meters)
     */
    getPointAtDistance(s, pointsArray) {
        const N = pointsArray.length;
        if (N === 0) return { pos: new THREE.Vector3(), heading: 0, tangent: new THREE.Vector3(0, 0, 1), kappa: 0.0 };

        let normS = s % this.lapLength;
        if (normS < 0) normS += this.lapLength;

        const idxFloat = (normS / this.lapLength) * N;
        const i0 = Math.floor(idxFloat) % N;
        const i1 = (i0 + 1) % N;
        const frac = idxFloat - Math.floor(idxFloat);

        const pPrev = pointsArray[(i0 - 1 + N) % N].pos;
        const p0 = pointsArray[i0].pos;
        const p1 = pointsArray[i1].pos;
        const pNext = pointsArray[(i1 + 1) % N].pos;

        // Smooth cubic Catmull-Rom interpolation for position
        const t = frac;
        const t2 = t * t;
        const t3 = t2 * t;

        const pos = new THREE.Vector3(
            0.5 * ((2 * p0.x) + (-pPrev.x + p1.x) * t + (2 * pPrev.x - 5 * p0.x + 4 * p1.x - pNext.x) * t2 + (-pPrev.x + 3 * p0.x - 3 * p1.x + pNext.x) * t3),
            0.5 * ((2 * p0.y) + (-pPrev.y + p1.y) * t + (2 * pPrev.y - 5 * p0.y + 4 * p1.y - pNext.y) * t2 + (-pPrev.y + 3 * p0.y - 3 * p1.y + pNext.y) * t3),
            0.5 * ((2 * p0.z) + (-pPrev.z + p1.z) * t + (2 * pPrev.z - 5 * p0.z + 4 * p1.z - pNext.z) * t2 + (-pPrev.z + 3 * p0.z - 3 * p1.z + pNext.z) * t3)
        );

        // Smooth continuous tangent from spline velocity derivative
        const tangent = new THREE.Vector3(
            0.5 * ((-pPrev.x + p1.x) + 2 * (2 * pPrev.x - 5 * p0.x + 4 * p1.x - pNext.x) * t + 3 * (-pPrev.x + 3 * p0.x - 3 * p1.x + pNext.x) * t2),
            0.5 * ((-pPrev.y + p1.y) + 2 * (2 * pPrev.y - 5 * p0.y + 4 * p1.y - pNext.y) * t + 3 * (-pPrev.y + 3 * p0.y - 3 * p1.y + pNext.y) * t2),
            0.5 * ((-pPrev.z + p1.z) + 2 * (2 * pPrev.z - 5 * p0.z + 4 * p1.z - pNext.z) * t + 3 * (-pPrev.z + 3 * p0.z - 3 * p1.z + pNext.z) * t2)
        ).normalize();

        const heading = Math.atan2(tangent.x, tangent.z);
        const kappa0 = pointsArray[i0].kappa || 0.0;
        const kappa1 = pointsArray[i1].kappa || 0.0;
        const kappa = kappa0 * (1 - frac) + kappa1 * frac;

        return { pos, heading, tangent, kappa };
    }

    /**
     * Updates vehicle avatar position, rotation, wheel spin & steering
     */
    updateVehiclePosition(s, speedKmh = 26.5, dt = 0.016) {
        if (!this.vehicleMesh || this.racingLinePoints.length === 0) return;

        const { pos, heading, tangent, kappa } = this.getPointAtDistance(s, this.racingLinePoints);
        this.vehicleMesh.position.copy(pos);
        this.vehicleMesh.rotation.y = heading;

        // Pitch based on elevation grade
        const pitch = Math.asin(Math.max(-1, Math.min(1, tangent.y)));
        this.vehicleMesh.rotation.x = -pitch;

        // Subtle lateral banking roll
        const vMps = (speedKmh || 26.5) / 3.6;
        const roll = Math.max(-0.12, Math.min(0.12, -(kappa * vMps * vMps) / 25.0));
        this.vehicleMesh.rotation.z = roll;

        // Real wheel rotation based on car speed
        const dTheta = (vMps * (dt || 0.016)) / (this.wheelRadius || 0.35);
        this.wheelRotation += dTheta;

        for (let i = 0; i < this.wheels.length; i++) {
            this.wheels[i].rotation.x = this.wheelRotation;
        }

        // Steer front wheels slightly into turn
        const steerAngle = Math.atan(2.6 * kappa);
        for (let i = 0; i < this.frontWheels.length; i++) {
            this.frontWheels[i].rotation.y = steerAngle;
        }

        return { pos, heading, tangent };
    }

    /**
     * Updates optimal Ghost Car position on the racing line
     */
    updateGhostPosition(s) {
        if (!this.ghostMesh || this.racingLinePoints.length === 0) return;

        const { pos, heading } = this.getPointAtDistance(s, this.racingLinePoints);
        this.ghostMesh.position.copy(pos);
        this.ghostMesh.rotation.y = heading;
    }

    /**
     * Multi-Camera Viewport Controller
     * Modes: 'orbit', 'chase', 'cockpit', 'map'
     */
    updateCameraPerspective(mode, controls, currentS) {
        if (this.racingLinePoints.length === 0) return;

        const { pos, tangent } = this.getPointAtDistance(currentS, this.racingLinePoints);

        if (mode === 'chase') {
            controls.enabled = false;
            const behind = tangent.clone().multiplyScalar(-11.0);
            const camPos = new THREE.Vector3().addVectors(pos, behind);
            camPos.y += 3.8;

            this.camera.position.lerp(camPos, 0.15);
            const lookTarget = pos.clone().add(tangent.clone().multiplyScalar(7.0));
            this.camera.lookAt(lookTarget);

        } else if (mode === 'cockpit') {
            controls.enabled = false;
            const eyePos = pos.clone().add(new THREE.Vector3(0, 0.85, 0)).add(tangent.clone().multiplyScalar(0.3));
            this.camera.position.copy(eyePos);

            const lookTarget = pos.clone().add(tangent.clone().multiplyScalar(30.0));
            lookTarget.y += 0.85;
            this.camera.lookAt(lookTarget);

        } else if (mode === 'map') {
            controls.enabled = false;
            this.camera.position.set(0, 1350, 0);
            this.camera.lookAt(0, 0, 0);

        } else {
            controls.enabled = true;
        }
    }
}
