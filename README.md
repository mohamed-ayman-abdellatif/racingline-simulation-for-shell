# Shell Eco-Marathon 3D & WebXR Simulation Visualizer
### Lusail International Circuit (Qatar) — Optimal Racing Line & Energy Strategy

🎮 **Play Online Directly in Browser:** [https://mohamed-ayman-abdellatif.github.io/racingline-simulation-for-shell/](https://mohamed-ayman-abdellatif.github.io/racingline-simulation-for-shell/)

---

## 🏎️ Features
- **3D Real-Time Physics & Track Visualizer:** Built with Three.js (Zero-build ES modules, runs natively in all modern desktop and mobile browsers).
- **Realistic 3D Car Avatars:** Select between Ferrari 458 Italia, Real GT Car, or the Aerodynamic Shell Eco-Marathon Prototype.
- **Topography & Elevation Profile:** Full 3,676.23 m Lusail circuit with true surveyed elevation swinging between +11.7m and +19.2m.
- **Minimum-Curvature Racing Line:** Over 22.8% peak curvature reduction cutting tire scrub resistance ($F_{\text{scrub}} \propto v^4 \kappa^2$).
- **Live Strategy Parameters:**
  - Adjustable Burn Cutoff / Top Speed ($v_{\text{high}}$)
  - Coast Floor / Burn Trigger ($v_{\text{low}}$)
  - Motor Burst Force ($F_{\text{burst}}$)
  - Vehicle & Driver Mass, Aero ($C_d A$), and Rolling Resistance ($C_{rr}$)
  - Presets: Optimal Burn-and-Coast, Safe Pace, Sprint, Defaults
- **Dual Heatmap Modes:** Toggle between Velocity Gradient Heatmap and Burn/Coast/Brake Powertrain Zones.
- **Multi-Camera Modes:** Orbit 3D Inspection, 3rd-Person Chase Cam, POV Driver Cockpit, and Top-Down Circuit Map.
- **Augmented Reality (WebXR):** Place the 3D Lusail track on a physical tabletop.

---

## 🚀 Running Locally
Simply open `index.html` via any local HTTP server:
```bash
python -m http.server 8080
```
Then navigate to `http://localhost:8080`.
