interface StudioFrameProps {
  src: string
  title: string
}

export function StudioFrame({ src, title }: StudioFrameProps) {
  return (
    <main className="frame-shell">
      <iframe className="studio-frame" src={src} title={title} />
    </main>
  )
}
