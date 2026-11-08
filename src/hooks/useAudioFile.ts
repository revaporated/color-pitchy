import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

export const useAudioFile = () => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isDecoding, setIsDecoding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)

  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!audioUrl) return

    return () => {
      URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const isMp3 =
      file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3')

    setError(null)
    setIsDecoding(true)
    setAudioBuffer(null)
    setDuration(0)
    setFileName(file.name)

    if (!isMp3) {
      setError('Please choose an MP3 file.')
      setIsDecoding(false)
      return
    }

    const nextUrl = URL.createObjectURL(file)
    setAudioUrl(nextUrl)

    try {
      const arrayBuffer = await file.arrayBuffer()
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      const decoded = await context.decodeAudioData(arrayBuffer)

      setAudioBuffer(decoded)
      setDuration(decoded.duration)
    } catch {
      setError('Unable to decode this audio file.')
      setAudioBuffer(null)
    } finally {
      setIsDecoding(false)
    }
  }, [])

  return {
    audioUrl,
    audioBuffer,
    fileName,
    isDecoding,
    error,
    duration,
    setError,
    handleFileChange,
  }
}
