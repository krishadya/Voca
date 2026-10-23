import { useEffect, useRef } from 'react'
import { RecordingController } from './recording-controller'

interface AudioRecorderProps {
  listening: boolean
  sessionId: number
}

function preferredMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

export function AudioRecorder({ listening, sessionId }: AudioRecorderProps): null {
  const controllerRef = useRef<RecordingController | null>(null)

  // Register teardown before the state effect so React StrictMode remounts
  // create a fresh controller without leaving a pending microphone request.
  useEffect(() => () => {
    controllerRef.current?.dispose()
    controllerRef.current = null
  }, [])

  useEffect(() => {
    controllerRef.current ??= new RecordingController({
      acquireStream: () => navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      }),
      createRecorder: (stream) => {
        const mimeType = preferredMimeType()
        return new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      },
      now: () => performance.now(),
      onComplete: (payload) => window.voca.transcribeRecording(payload),
      onError: (id, category) => window.voca.reportRecordingError({ sessionId: id, message: category }),
      onDiscard: (id) => window.voca.discardRecording(id),
      onDiagnostic: (event) => {
        if (import.meta.env.DEV) window.voca.reportRecordingDiagnostic(event)
      }
    })
    controllerRef.current.update(listening, sessionId)
  }, [listening, sessionId])

  return null
}
