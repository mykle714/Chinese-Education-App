import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';

// Pitch-preserving time-stretch for TTS playback.
//
// Why this exists: the cloud provider plays decoded MP3 through a Web Audio
// AudioBufferSourceNode (deliberately, to avoid iOS lock-screen media controls —
// see CloudTTSProvider). But AudioBufferSourceNode.playbackRate *resamples*, so
// any rate != 1.0 shifts pitch up/down with the speed and distorts Chinese tones.
//
// To honor the user's speech-rate setting WITHOUT changing pitch we time-stretch
// the decoded buffer offline with a phase-vocoder (SoundTouch's WSOLA), then play
// the result at playbackRate 1.0. Done once per (buffer, rate) and cached by the
// caller, so dragging the rate slider stays responsive.

const BLOCK_FRAMES = 4096;

/**
 * Return a new AudioBuffer that plays `buffer` at `tempo`× speed with the
 * original pitch preserved. `tempo` is the playback-speed multiplier (e.g. 1.25
 * = 25% faster). Returns the input unchanged for tempo ≈ 1 (no work, no
 * artifacts). `ctx` is only used to allocate the output buffer.
 */
export function timeStretchBuffer(
    ctx: BaseAudioContext,
    buffer: AudioBuffer,
    tempo: number,
): AudioBuffer {
    // Near-unity: skip the DSP entirely so 1.0× is bit-for-bit the original.
    if (!Number.isFinite(tempo) || Math.abs(tempo - 1) < 0.001) return buffer;

    const pipe = new SoundTouch();
    pipe.tempo = tempo; // change speed…
    pipe.pitch = 1; // …but leave pitch untouched
    const filter = new SimpleFilter(new WebAudioBufferSource(buffer), pipe);

    // SoundTouch emits interleaved stereo regardless of input channel count.
    const interleaved = new Float32Array(BLOCK_FRAMES * 2);
    const chunks: Float32Array[] = [];
    let totalFrames = 0;

    // Pull processed frames until the source is exhausted (extract returns 0).
    let extracted = filter.extract(interleaved, BLOCK_FRAMES);
    while (extracted > 0) {
        chunks.push(interleaved.slice(0, extracted * 2));
        totalFrames += extracted;
        extracted = filter.extract(interleaved, BLOCK_FRAMES);
    }

    // De-interleave back into the channel layout we play. TTS is mono, so we
    // collapse to one channel there; preserve stereo for any 2-channel source.
    const numChannels = buffer.numberOfChannels >= 2 ? 2 : 1;
    const out = ctx.createBuffer(numChannels, Math.max(1, totalFrames), buffer.sampleRate);
    const left = out.getChannelData(0);
    const right = numChannels > 1 ? out.getChannelData(1) : null;

    let frame = 0;
    for (const chunk of chunks) {
        const frames = chunk.length / 2;
        for (let i = 0; i < frames; i++) {
            left[frame] = chunk[i * 2];
            if (right) right[frame] = chunk[i * 2 + 1];
            frame++;
        }
    }
    return out;
}
