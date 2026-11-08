import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

type Options = {
  onPlayError?: () => void
}

type AudioPlayback = {
  audioRef: RefObject<HTMLAudioElement>
  isPlaying: boolean
  /**
   * Song position as of the last pause, seek, stop or end. Deliberately not
   * updated during playback: anything animated reads the PlaybackClock on the
   * shared frame loop instead, so playing never re-renders the page.
   */
  currentTime: number
  playPause: () => void
  stop: () => void
  seek: (time: number) => void
}

export const useAudioPlayback = ({ onPlayError }: Options = {}): AudioPlayback => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioElementRef = audioRef as RefObject<HTMLAudioElement>
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => {
      setIsPlaying(false)
      setCurrentTime(audio.currentTime)
    }
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(audio.duration || audio.currentTime)
    }
    const handleSeeked = () => {
      if (audio.paused) setCurrentTime(audio.currentTime)
    }
    const handleLoaded = () => setCurrentTime(audio.currentTime)

    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('seeked', handleSeeked)
    audio.addEventListener('loadedmetadata', handleLoaded)

    return () => {
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('seeked', handleSeeked)
      audio.removeEventListener('loadedmetadata', handleLoaded)
    }
  }, [])

  const playPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      void audio.play().catch(() => {
        onPlayError?.()
      })
      return
    }

    audio.pause()
  }, [onPlayError])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.pause()
    audio.currentTime = 0
    setCurrentTime(0)
  }, [])

  const seek = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio) return

    audio.currentTime = time
    if (audio.paused) setCurrentTime(time)
  }, [])

  return { audioRef: audioElementRef, isPlaying, currentTime, playPause, stop, seek }
}
