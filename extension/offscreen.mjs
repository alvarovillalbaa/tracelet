import { addChunk, getSession, updateSession } from './lib/db.mjs';

let active = null;
let starting = false;

async function stop(reason = 'Stopped by you.', partial = false) {
  if (!active) return null;
  const capture = active;
  if (capture.stopping) return capture.finished;
  capture.stopping = true;
  capture.reason = reason;
  capture.partial ||= partial;
  clearTimeout(capture.timer);
  if (capture.recorder.state !== 'inactive') capture.recorder.stop();
  else capture.finish();
  return capture.finished;
}

async function start({ sessionId, streamId }) {
  if (active || starting) throw new Error('Another recording is active.');
  starting = true;
  let stream;
  try {
    const session = await getSession(sessionId);
    if (!session || session.status !== 'recording') throw new Error('Recording was not prepared.');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
    });
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This Chrome installation cannot encode WebM video.');
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
    let resolveFinished;
    const capture = { sessionId, stream, recorder, sequence: 0, pending: Promise.resolve(), stopping: false, partial: false,
      finished: new Promise(resolve => { resolveFinished = resolve; }) };
    capture.finish = async () => {
      if (capture.finishing) return;
      capture.finishing = true;
      clearTimeout(capture.timer);
      stream.getTracks().forEach(track => track.stop());
      await capture.pending;
      let failure;
      try {
        await updateSession(sessionId, row => ({ ...row,
          stoppedAt: Date.now(), status: capture.partial ? 'partial' : 'complete',
          reason: capture.reason || 'The browser ended this recording.'
        }));
      } catch { failure = 'Video finalization could not be saved. Existing chunks may be partial.'; }
      active = null;
      resolveFinished({ sessionId, error: failure });
      chrome.runtime.sendMessage({ target: 'worker', type: 'capture-finished', sessionId, error: failure }).catch(() => {});
    };
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      const sequence = capture.sequence++;
      capture.pending = capture.pending.then(() => addChunk(sessionId, sequence, event.data)).catch(error => {
        capture.partial = true;
        capture.reason = error.message;
        void stop(error.message, true);
      });
    };
    recorder.onerror = () => { void stop('Chrome could not continue encoding. Saved video is partial.', true); };
    recorder.onstop = capture.finish;
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { void stop('The browser ended capture.', true); }, { once: true }));
    active = capture;
    capture.timer = setTimeout(() => { void stop('The five-minute recording limit was reached.'); }, 300_000);
    recorder.start(1000);
    return { sessionId };
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    active = null;
    throw error;
  } finally { starting = false; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'offscreen') return;
  const handler = async () => {
    if (message.type === 'status') return { sessionId: active?.sessionId ?? null };
    if (message.type === 'start') return start(message);
    if (message.type === 'stop') return stop(message.reason, Boolean(message.partial));
    throw new Error('Unknown recorder operation.');
  };
  handler().then(result => respond({ ok: true, ...result })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
