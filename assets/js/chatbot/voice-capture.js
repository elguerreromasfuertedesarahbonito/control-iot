/** Captura bajo demanda para navegadores cuyo servicio de dictado falla. */
const FORMATS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);
const MAX_AUDIO_BYTES = 1024 * 1024;
const SPEECH_RMS = 0.025;
const SAMPLE_MS = 50;
const TRANSCRIPTION_ERRORS = new Map([
  [404, 'transcription-not-installed'],
  [413, 'audio-too-large'],
  [415, 'audio-format'],
  [429, 'transcription-rate-limit'],
]);

const baseType = value => String(value ?? '').split(';', 1)[0].trim().toLowerCase();

function stopTracks(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function microphoneError(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error?.name)) return 'not-allowed';
  return 'audio-capture';
}

/**
 * Adapta MediaRecorder a los eventos que utiliza createVoiceInput.
 * transcribe recibe un Blob de audio y { signal, language }, y devuelve texto.
 */
export function createRecordedRecognition({
  transcribe,
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderImpl = globalThis.MediaRecorder,
  AudioContextImpl = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  maxBytes = MAX_AUDIO_BYTES,
} = {}) {
  if (typeof transcribe !== 'function' || typeof mediaDevices?.getUserMedia !== 'function'
    || typeof MediaRecorderImpl !== 'function') return null;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('El límite de audio debe ser positivo.');

  return class RecordedRecognition {
    static endTimeoutMs = 30000;
    #session = null;

    start() {
      if (this.#session) return;
      const session = { stream: null, recorder: null, chunks: [], size: 0, type: '', stopping: false, uploading: false, controller: new AbortController(), releaseSampler: null };
      this.#session = session;
      // getUserMedia se invoca en la misma interacción que activó el micrófono.
      this.#record(session).catch(error => this.#finish(session, microphoneError(error)));
    }

    async #record(session) {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      if (this.#session !== session) {
        stopTracks(stream);
        return;
      }
      session.stream = stream;
      const mimeType = FORMATS.find(type => MediaRecorderImpl.isTypeSupported?.(type));
      const options = { audioBitsPerSecond: 64000 };
      if (mimeType) options.mimeType = mimeType;
      const recorder = new MediaRecorderImpl(stream, options);
      session.recorder = recorder;
      recorder.ondataavailable = event => this.#receive(session, event.data);
      recorder.onerror = event => this.#finish(session, microphoneError(event.error));
      recorder.onstop = () => { void this.#transcribe(session); };
      recorder.start(250);
      this.#observeSpeech(session);
      this.onstart?.();
    }

    #observeSpeech(session) {
      if (typeof AudioContextImpl !== 'function') return;
      let context;
      try {
        context = new AudioContextImpl();
        const source = context.createMediaStreamSource(session.stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let speaking = false;
        const timer = setInterval(() => {
          if (this.#session !== session || session.stopping || context.state !== 'running') return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
          const active = rms >= SPEECH_RMS;
          if (active === speaking) return;
          speaking = active;
          if (active) this.onspeechstart?.();
          else this.onspeechend?.();
        }, SAMPLE_MS);
        session.releaseSampler = () => {
          clearInterval(timer);
          source.disconnect();
          analyser.disconnect();
          void context.close().catch(() => {});
        };
        void context.resume().catch(() => {});
      } catch {
        if (context) void context.close().catch(() => {});
        // Sin analizador, el toque o la liberación todavía pueden terminar la grabación.
      }
    }

    #receive(session, chunk) {
      if (this.#session !== session || !chunk?.size || session.uploading) return;
      const type = baseType(chunk.type || session.recorder.mimeType);
      if (!AUDIO_TYPES.has(type) || (session.type && type !== session.type)) {
        this.#finish(session, 'audio-format');
        return;
      }
      if (session.size + chunk.size > maxBytes) {
        this.#finish(session, 'audio-too-large');
        return;
      }
      session.type = type;
      session.size += chunk.size;
      session.chunks.push(chunk);
    }

    stop() {
      const session = this.#session;
      if (!session || session.stopping) return;
      session.stopping = true;
      if (!session.recorder) {
        this.#finish(session, 'no-speech');
        return;
      }
      try {
        session.recorder.stop();
      } catch (error) {
        this.#finish(session, microphoneError(error));
      } finally {
        this.#releaseMic(session);
      }
    }

    abort() {
      const session = this.#session;
      if (session) this.#finish(session);
    }

    #releaseMic(session) {
      session.releaseSampler?.();
      session.releaseSampler = null;
      const stream = session.stream;
      session.stream = null;
      stopTracks(stream);
    }

    async #transcribe(session) {
      if (this.#session !== session || session.uploading) return;
      if (!session.stopping) {
        this.#finish(session, 'audio-capture');
        return;
      }
      if (!session.size) {
        this.#finish(session, 'no-speech');
        return;
      }
      session.uploading = true;
      this.#releaseMic(session);
      const audio = new Blob(session.chunks, { type: session.type });
      session.chunks = [];
      let transcript;
      try {
        transcript = await transcribe(audio, {
          signal: session.controller.signal, language: this.lang ?? 'es-MX',
        });
      } catch (error) {
        if (this.#session !== session) return;
        const code = TRANSCRIPTION_ERRORS.get(error?.status) ?? 'transcription-unavailable';
        this.#finish(session, code);
        return;
      }
      if (this.#session !== session) return;
      const text = typeof transcript === 'string' ? transcript.trim().slice(0, 1000) : '';
      if (!text) {
        this.#finish(session, 'no-speech');
        return;
      }
      const results = [Object.assign([{ transcript: text }], { isFinal: true })];
      try { this.onresult?.({ resultIndex: 0, results }); }
      finally { this.#finish(session); }
    }

    #finish(session, error) {
      if (this.#session !== session) return;
      this.#session = null;
      session.controller.abort();
      session.chunks = [];
      const recorder = session.recorder;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch { /* Puede haber terminado al cerrar el micrófono. */ }
        }
      }
      this.#releaseMic(session);
      try { if (error) this.onerror?.({ error }); }
      finally { this.onend?.(); }
    }
  };
}
