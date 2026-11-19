// The Barnacle wordmark (docs/DESIGN.md § Wordmark): orange sunburst logo + BARNACLE_LABS with an orange "_".
export function Wordmark({ centre = "#2B00FF" }: { centre?: string }) {
  return (
    <div className="wordmark">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <polygon
          fill="#FF4201"
          points="12,0 13.6,8.2 20.5,3.5 15.8,10.4 24,12 15.8,13.6 20.5,20.5 13.6,15.8 12,24 10.4,15.8 3.5,20.5 8.2,13.6 0,12 8.2,10.4 3.5,3.5 10.4,8.2"
        />
        <circle cx="12" cy="12" r="3.2" fill={centre} />
      </svg>
      <span>
        BARNACLE<span className="underscore">_</span>LABS
      </span>
    </div>
  );
}
