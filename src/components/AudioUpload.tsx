import type { ChangeEvent } from 'react'

type Props = {
  fileName: string | null
  isDecoding: boolean
  error: string | null
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export const AudioUpload = ({ fileName, isDecoding, error, onFileChange }: Props) => {
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
          <input type="file" accept="audio/mpeg,.mp3" onChange={onFileChange} />
        </label>
        {fileName && <span className="file-meta">{fileName}</span>}
        {isDecoding && <span className="file-meta">Decoding audio...</span>}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
