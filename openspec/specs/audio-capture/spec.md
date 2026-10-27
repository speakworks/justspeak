# audio-capture Specification

## Purpose
Defines how microphone audio becomes bounded 16 kHz mono PCM16 frames that cross the renderer-to-main bridge, how the session buffer is limited, and how the captured utterance is finalized into a temporary WAV for transcription.

## Requirements

### Requirement: Renderer capture SHALL emit 16 kHz mono PCM16 batches

The renderer capture path SHALL convert microphone samples to 16 kHz mono signed 16-bit PCM and SHALL post bounded batches to the main process through the preload bridge. The AudioWorklet posts Float32 quanta; a pure batcher clamps and converts them to Int16 20 ms batches (320 samples at 16 kHz), which are the only samples sent over IPC.

#### Scenario: Typical batch cadence

- **WHEN** capture is running
- **THEN** the renderer emits Int16 batches of 20 ms (320 samples at 16 kHz) using transferable buffers
- **AND** each batch carries a monotonically increasing sequence number and its capture timestamp
- **AND** the Float32-to-Int16 conversion clamps values to the signed 16-bit range

#### Scenario: Context sample rate is not 16 kHz

- **WHEN** the created AudioContext reports a sample rate other than 16,000 Hz
- **THEN** the controller releases the microphone and closes the context
- **AND** it reports a visible error instead of sending wrong-rate PCM

#### Scenario: Bounded batch size

- **WHEN** a batch arrives with more samples than the configured maximum batch size
- **THEN** main rejects that batch and reports a capture error
- **AND** it does not append the oversized payload to the session buffer

#### Scenario: Batch from an untrusted sender

- **WHEN** a PCM batch arrives from a webContents other than the app's main window
- **THEN** main discards it without appending audio or changing state

### Requirement: Main SHALL bound the session audio buffer

The main process SHALL accept PCM batches only while a session is recording, SHALL bound the buffer at 120 seconds of 16 kHz mono audio, and SHALL ignore batches that arrive after stop is acknowledged.

#### Scenario: Buffer overflow

- **WHEN** the accumulated audio would exceed 120 seconds
- **THEN** the session transitions to error with an `AUDIO_TOO_LONG`-style message
- **AND** audio is not silently truncated and no partial transcript is presented as complete

#### Scenario: Late frame after stop

- **WHEN** a PCM batch arrives after the session has left the recording state
- **THEN** main discards it without changing the finalized audio

#### Scenario: Stop flushes captured audio

- **WHEN** the user stops recording while the session is recording
- **THEN** the renderer flushes the final partial 20 ms batch, stops tracks, closes the audio context, and sends the stop summary after the last batch
- **AND** main assembles all accepted batches in sequence order into one utterance

### Requirement: Finalized audio SHALL be encoded as a valid 16 kHz mono WAV

The application SHALL encode finalized PCM as a RIFF/WAVE PCM16 mono file at 16 kHz with correct header sizes before invoking the ASR provider.

#### Scenario: WAV header correctness

- **WHEN** the session audio is finalized
- **THEN** the WAV header declares PCM format, one channel, 16,000 samples per second, 16 bits per sample, and byte counts matching the payload

#### Scenario: Empty session

- **WHEN** stop occurs with no captured samples
- **THEN** the session returns to idle with a visible notice
- **AND** no ASR call is made

### Requirement: Capture lifecycle edges SHALL be deterministic

The renderer capture controller SHALL make stop-during-getUserMedia, start-while-starting, addModule failure, and post-acknowledgement stop deterministic and testable.

#### Scenario: Stop during getUserMedia

- **WHEN** stop arrives while microphone acquisition is still pending
- **THEN** acquisition is marked cancelled, any late stream tracks are stopped, and no audio context or worklet is left running
- **AND** the capture layer reports the cancellation and returns to its idle state
- **AND** the session surfaces that report as an error with a retry message per the capture-failure rule

#### Scenario: Retry during start

- **WHEN** start is requested while a previous start is still in progress
- **THEN** the second start is rejected with a clear retry-later message
- **AND** resources from the first start are not leaked

#### Scenario: addModule failure

- **WHEN** the AudioWorklet module fails to load
- **THEN** the microphone stream is stopped, the audio context is closed, and the error is surfaced to the session
- **AND** a later start attempt can succeed

#### Scenario: Stop after start acknowledgement

- **WHEN** a start has completed and the user stops
- **THEN** exactly one stop summary is sent with duration, samples, sample rate, and RMS
- **AND** stopping with no active capture reports a visible error instead of a stale transcript
