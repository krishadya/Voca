import { useEffect, useRef } from 'react'

interface AudioRecorderProps {
  listening: boolean
  sessionId: number
}

function preferredMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

export function AudioRecorder({ listening, sessionId }: AudioRecorderProps): null {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const operationRef = useRef(0)

  useEffect(() => {
    const operation = ++operationRef.current

    if (listening) {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          })

          if (operationRef.current !== operation) {
            stream.getTracks().forEach((track) => track.stop())
            window.voca.reportRecordingError({
              sessionId,
              message: 'Recording ended before the microphone was ready'
            })
            return
          }

          const mimeType = preferredMimeType()
          const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
          const chunks: Blob[] = []
          const startedAt = performance.now()

          recorder.addEventListener('dataavailable', (event) => {
            if (event.data.size > 0) chunks.push(event.data)
          })

          recorder.addEventListener('stop', async () => {
            const recordingMimeType = recorder.mimeType || mimeType || 'audio/webm'
            const durationMs = performance.now() - startedAt
            stream.getTracks().forEach((track) => track.stop())

            try {
              const blob = new Blob(chunks, { type: recordingMimeType })
              const audioData = await blob.arrayBuffer()
              chunks.length = 0
              await window.voca.transcribeRecording({
                sessionId,
                durationMs,
                mimeType: recordingMimeType,
                audioData
              })
            } catch (error) {
              window.voca.reportRecordingError({
                sessionId,
                message: error instanceof Error ? error.message : String(error)
              })
            }
          })

          recorder.start(250)
          recorderRef.current = recorder
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          window.voca.reportRecordingError({ sessionId, message })
        }
      })()
    } else {
      const recorder = recorderRef.current
      recorderRef.current = null
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    }

    return () => {
      if (operationRef.current === operation) ++operationRef.current
    }
  }, [listening, sessionId])

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    }
  }, [])

  return null
}
