import type { ChangeEvent } from 'react'

type Props = {
  fileName: string | null
  isDecoding: boolean
  error: string | null
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export const AudioUpload = ({
  fileName,
  isDecoding,
  error,
  onFileChange,
}: Props) => {
  return (
    <div className="card studio-upload-card">
      <div className="file-row">
        <label>
          <span className="sr-only">Upload Backing Track</span>
          <input type="file" accept="audio/mpeg,.mp3" onChange={onFileChange} />
        </label>
        {fileName && <span className="file-meta">{fileName}</span>}
        {isDecoding && <span className="file-meta">Analyzing audio...</span>}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
