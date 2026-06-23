// Minimal ambient declaration for soundtouchjs (the package ships no types).
// We only use the offline-processing surface: feed an AudioBuffer through a
// SoundTouch pipe via a SimpleFilter and pull processed interleaved-stereo
// frames out with extract(). See src/services/tts/timeStretch.ts.
declare module 'soundtouchjs' {
    // The DSP core. `tempo` changes speed while preserving pitch; `pitch` is a
    // multiplicative pitch factor (1 = unchanged). We set tempo and leave pitch
    // at 1 to time-stretch without the resampling pitch shift.
    export class SoundTouch {
        tempo: number;
        pitch: number;
        rate: number;
    }

    // Wraps an AudioBuffer as a sample source for SimpleFilter. extract() fills
    // an interleaved-stereo Float32Array.
    export class WebAudioBufferSource {
        constructor(buffer: AudioBuffer);
        extract(target: Float32Array, numFrames: number, position?: number): number;
    }

    // Pulls processed frames through the pipe. extract(target, numFrames) writes
    // interleaved-stereo samples into `target` and returns the frame count
    // actually produced (0 when the source is exhausted).
    export class SimpleFilter {
        constructor(sourceSound: WebAudioBufferSource, pipe: SoundTouch);
        extract(target: Float32Array, numFrames: number): number;
    }
}
