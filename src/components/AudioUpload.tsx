import { useRef } from 'react'
import type { ChangeEvent } from 'react'

type Props = {
  fileName: string | null
  isDecoding: boolean
  error: string | null
  /** Shrink to a single line (used once a track has loaded). */
  collapsed?: boolean
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export const AudioUpload = ({ fileName, isDecoding, error, collapsed = false, onFileChange }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null)

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="audio/mpeg,.mp3"
      onChange={onFileChange}
      className={collapsed ? 'sr-only' : undefined}
    />
  )

  if (collapsed) {
    return (
      <div className="card songs-card songs-card--collapsed">
        <div className="file-row">
          <span className="stat-label">Track</span>
          <span className="file-meta">{fileName}</span>
          <button type="button" className="toggle-button" onClick={() => inputRef.current?.click()}>
            Change track
          </button>
          <label>
            <span className="sr-only">Load MP3</span>
            {input}
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="card songs-card">
      <h1>Track</h1>
      <p>
        Load an MP3 to sing or play along with it. Your pitch is drawn on the same timeline as the
        waveform, over the track's own pitch contour.
      </p>
      <div className="file-row">
        <label>
          <span className="sr-only">Load MP3</span>
          {input}
        </label>
        {fileName && <span className="file-meta">{fileName}</span>}
        {isDecoding && <span className="file-meta">Decoding audio...</span>}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
