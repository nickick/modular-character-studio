import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="home-shell">
      <p className="home-kicker">Local-first 2D character authoring</p>
      <h1>Modular Character Studio</h1>
      <p className="home-intro">
        Pose a layered cutout rig, tune animation and wrist deformation, then
        fit armor and held equipment against the same scene.
      </p>
      <section className="studio-grid" aria-label="Studios">
        <a className="studio-card" href="/rig">
          <span>Rig Studio</span>
          <strong>Skeleton, layers, animation, and deformation</strong>
          <small>Open the shared character rig</small>
        </a>
        <a className="studio-card" href="/equipment">
          <span>Equipment Studio</span>
          <strong>Armor and held-item placement</strong>
          <small>Fit the bundled leather, mage, metal, and weapon examples</small>
        </a>
      </section>
      <p className="license-note">MIT code · CC0 bundled demo art</p>
    </main>
  )
}
