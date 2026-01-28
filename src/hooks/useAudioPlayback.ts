import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

type Options = {
  onPlayError?: () => void
}

type AudioPlayback = {
  audioRef: RefObject<HTMLAudioElement>
  isPlaying: boolean
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
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(audio.duration || audio.currentTime)
    }
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)

    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('timeupdate', handleTimeUpdate)

    return () => {
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
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
    setCurrentTime(time)
  }, [])

  return { audioRef: audioElementRef, isPlaying, currentTime, playPause, stop, seek }
}
