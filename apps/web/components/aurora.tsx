/** The soft lavender glow behind a section. Decorative; it drifts slowly unless motion is reduced. */
export function Aurora({ faint = false, className = '' }: { faint?: boolean; className?: string }) {
  return (
    <div aria-hidden className={`aurora ${faint ? 'aurora-faint' : ''} ${className}`}>
      <span className="aurora-blob" />
      <span className="aurora-blob" />
      <span className="aurora-blob" />
    </div>
  );
}
